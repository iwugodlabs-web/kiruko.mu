from fastapi import APIRouter, UploadFile, File, HTTPException
try:
    import pytesseract
except ImportError:
    pytesseract = None
from PIL import Image, ImageEnhance, ImageFilter
import io
import json
import logging
import re
from datetime import datetime
from pydantic import BaseModel
from typing import Optional, List, Literal
import numpy as np
import os
from dotenv import load_dotenv

from services import document_ai_service

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)

# Google Cloud Vision (optional, falls back to EasyOCR if not configured)

try:
    from google.cloud import vision
    GOOGLE_VISION_AVAILABLE = True
except ImportError:
    GOOGLE_VISION_AVAILABLE = False
    print("WARNING: google-cloud-vision not installed. Using EasyOCR/Tesseract only.")

router = APIRouter()

# Initialize EasyOCR reader (lazy loading)
reader = None

def get_easyocr_reader():
    """
    Lazy load EasyOCR reader with English and French support.
    First run will download language models (~100MB each).

    `easyocr` itself (and the torch/torchvision it pulls in) is imported
    here rather than at module level — it's only the fallback OCR path
    behind Google Vision, so most boots and most requests never need it.
    Importing it eagerly at module load meant every app process (the
    startup import check, and uvicorn itself) paid torch's memory cost
    unconditionally, which was tight enough on a 512MB instance to
    contribute to OOM kills at boot.
    """
    global reader
    if reader is None:
        import easyocr
        # Initialize with both English and French
        reader = easyocr.Reader(['en', 'fr'])  # English + French
    return reader



class ScannedReceipt(BaseModel):
    merchant: Optional[str] = None
    date: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    tax: Optional[float] = None
    items: Optional[List[dict]] = []
    extraction_method: Optional[Literal["document_ai", "vision_heuristic", "easyocr_heuristic"]] = None
    overall_confidence: Optional[float] = None
    low_confidence_fields: List[str] = []
    # URL of the just-uploaded image, persisted via storage_service so the
    # mobile client can thread it through to POST /purchase and later
    # render the original receipt next to the parsed fields.
    receipt_image_url: Optional[str] = None

def is_valid_text(text: str, min_length: int = 3) -> bool:
    """
    Check if text looks like valid, readable content (not OCR garbage).
    
    Args:
        text: The text to validate
        min_length: Minimum length for valid text
    
    Returns:
        True if text appears to be valid, False if it's likely garbage
    """
    if not text or len(text) < min_length:
        return False
    
    # Remove common punctuation and whitespace for analysis
    clean = text.strip()
    
    # Count different character types
    alpha_count = sum(c.isalpha() for c in clean)
    digit_count = sum(c.isdigit() for c in clean)
    space_count = sum(c.isspace() for c in clean)
    special_count = sum(not c.isalnum() and not c.isspace() for c in clean)
    
    total_chars = len(clean)
    
    # Reject if too many special characters (>40% of text)
    if special_count > total_chars * 0.4:
        return False
    
    # Reject if it's a random mix with very few letters
    # (e.g., "OjSA *ao.Wer PIC $" has letters but looks random)
    if alpha_count < total_chars * 0.3:
        return False
    
    # Check for excessive random capitalization patterns
    # Valid text usually has consistent casing or proper title case
    if alpha_count > 0:
        upper_count = sum(c.isupper() for c in clean if c.isalpha())
        # If more than 70% uppercase but has lowercase too, might be random
        upper_ratio = upper_count / alpha_count
        if 0.3 < upper_ratio < 0.7 and alpha_count > 5:
            # Mixed case is suspicious if there are many special chars
            if special_count > alpha_count * 0.3:
                return False
    
    # Check for common OCR garbage patterns
    garbage_patterns = [
        r'[A-Za-z]{1}[^a-zA-Z\s]{1,3}[A-Za-z]{1}[^a-zA-Z\s]{1,3}',  # Alternating letter-symbol
        r'\*{2,}',  # Multiple asterisks
        r'[;:]{2,}',  # Multiple semicolons/colons
        r'[A-Z][a-z][A-Z][a-z][A-Z]',  # Weird alternating case
    ]
    
    for pattern in garbage_patterns:
        if re.search(pattern, clean):
            return False
    
    # Must have at least some consecutive letters (real words)
    if not re.search(r'[A-Za-z]{2,}', clean):
        return False
    
    return True

def fuzzy_parse_price(text: str, context: str = "") -> Optional[float]:
    """
    Parse a string into a float, handling common OCR errors for numbers.
    e.g. '9S' -> 95.0, 'S5' -> 55.0, 'O0' -> 100.0, '[410' -> 410.0
    
    Args:
        text: The text to parse
        context: The full line context to help avoid false positives
    """
    if not text:
        return None
    
    # 1. Safety check: specific common fully-alpha misreads
    common_misreads = {
        'S': 5.0, 'SS': 55.0, 's': 5.0, 'ss': 55.0,
        'O': 0.0, 'o': 0.0, 'OO': 0.0, 'oo': 0.0,
        'l': 1.0, 'll': 11.0, 'I': 1.0, 'II': 11.0
    }
    if text.strip() in common_misreads:
        return common_misreads[text.strip()]

    # 2. If it's a longer word with NO digits, assume it's text (merchant name, etc)
    if len(text) > 2 and not re.search(r'\d', text):
        return None
    
    # 3. Avoid parsing phone numbers, BRN codes, etc.
    # Phone numbers typically have 7+ consecutive digits or patterns like 123-4567
    if re.search(r'\d{7,}', text.replace('-', '').replace(' ', '')):
        # Check if context suggests this is metadata
        upper_context = context.upper()
        if any(kw in upper_context for kw in ['TEL', 'PHONE', 'FAX', 'BRN', 'REG', 'VAT:', 'ABN']):
            return None
    
    # 4. Avoid very large numbers that are likely IDs/codes (> 10000)
    # But allow them if they have decimal points (like 1234.56)
    if '.' not in text and ',' not in text:
        try:
            test_val = float(re.sub(r'[^\d]', '', text))
            if test_val > 100000:  # Likely a code/ID
                return None
        except:
            pass
        
    # removals
    clean = text.replace(' ', '').replace('[', '').replace(']', '').replace('{', '').replace('}', '').replace('(', '').replace(')', '')
    clean = clean.upper()
    
    # substitutions
    clean = clean.replace('S', '5')
    clean = clean.replace('O', '0')
    clean = clean.replace('Q', '0')
    clean = clean.replace('D', '0')
    clean = clean.replace('B', '8')
    clean = clean.replace('I', '1')
    clean = clean.replace('L', '1')
    clean = clean.replace('Z', '2')
    
    # Regex to find the number pattern (supports 1234.56 or 1234,56)
    match = re.search(r'(\d+(?:[.,]\d+)*)', clean)
    if match:
        num_str = match.group(1)
        # normalize decimal
        if ',' in num_str and '.' in num_str:
             if num_str.index(',') < num_str.index('.'):
                 num_str = num_str.replace(',', '')
             else:
                 num_str = num_str.replace('.', '').replace(',', '.')
        elif ',' in num_str:
             if len(num_str.split(',')[-1]) == 2:
                 num_str = num_str.replace(',', '.')
             else:
                 num_str = num_str.replace(',', '')
        
        try:
            value = float(num_str)
            # Reasonable price range check (0.01 to 999999.99)
            if 0.01 <= value <= 999999.99:
                return value
            return None
        except ValueError:
            return None
    return None

def run_tesseract_ocr(image: Image.Image):
    """
    Run Tesseract OCR and return results in EasyOCR-compatible format.
    Supports English and French for bilingual receipts.
    Returns: list of (bbox, text, confidence)
    """
    # Configure Tesseract for English + French
    # lang='eng+fra' tells Tesseract to recognize both languages
    custom_config = r'--oem 3 --psm 6'  # PSM 6 = Assume uniform block of text
    
    # Get detailed data from Tesseract
    data = pytesseract.image_to_data(
        image, 
        lang='eng+fra',  # English + French
        output_type=pytesseract.Output.DICT,
        config=custom_config
    )

    
    results = []
    n_boxes = len(data['text'])
    
    for i in range(n_boxes):
        text = data['text'][i].strip()
        if not text:  # Skip empty text
            continue
            
        # Get bounding box coordinates
        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
        
        # Convert to EasyOCR format: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        bbox = [
            [x, y],           # top-left
            [x + w, y],       # top-right
            [x + w, y + h],   # bottom-right
            [x, y + h]        # bottom-left
        ]
        
        # Tesseract confidence is 0-100, convert to 0-1
        confidence = float(data['conf'][i]) / 100.0
        
        results.append((bbox, text, confidence))
    
    
    return results

def run_google_vision_ocr(image: Image.Image):
    """
    Run Google Cloud Vision OCR and return results in EasyOCR-compatible format.
    Returns: list of (bbox, text, confidence)
    
    Requires GOOGLE_APPLICATION_CREDENTIALS environment variable to be set.
    """
    if not GOOGLE_VISION_AVAILABLE:
        raise ImportError("google-cloud-vision not installed")
    
    # Initialize Vision API client
    client = vision.ImageAnnotatorClient()
    
    # Convert PIL Image to bytes
    img_bytes = io.BytesIO()
    image.save(img_bytes, format='JPEG')
    img_bytes = img_bytes.getvalue()
    
    # Create Vision API image object
    vision_image = vision.Image(content=img_bytes)
    
    # Perform document text detection (better for receipts than basic text detection)
    response = client.document_text_detection(image=vision_image)
    
    if response.error.message:
        raise Exception(f"Google Vision API error: {response.error.message}")
    
    # Convert to EasyOCR-compatible format
    results = []
    
    if response.full_text_annotation:
        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        # Extract text from word symbols
                        text = ''.join([symbol.text for symbol in word.symbols])
                        
                        # Extract bounding box vertices
                        vertices = word.bounding_box.vertices
                        bbox = [
                            [vertices[0].x, vertices[0].y],  # top-left
                            [vertices[1].x, vertices[1].y],  # top-right
                            [vertices[2].x, vertices[2].y],  # bottom-right
                            [vertices[3].x, vertices[3].y]   # bottom-left
                        ]
                        
                        # Confidence (0-1)
                        confidence = word.confidence if hasattr(word, 'confidence') else 0.9
                        
                        results.append((bbox, text, confidence))
    
    return results

def group_text_by_lines(results, y_tolerance=15, min_confidence=0.3) -> List[str]:
    """
    Group EasyOCR results into lines based on Y-coordinate.
    Filters out low-confidence and garbage text.
    
    Args:
        results: list of (bbox, text, prob)
        y_tolerance: Y-coordinate tolerance for grouping into same line
        min_confidence: Minimum OCR confidence score (0.0 to 1.0)
    """
    lines = []
    current_line = []
    
    # Filter results by confidence and text quality
    filtered_results = []
    for bbox, text, prob in results:
        # Skip low confidence results
        if prob < min_confidence:
            print(f"DEBUG: Skipping low confidence ({prob:.2f}): '{text}'")
            continue
        
        # Skip garbage text, BUT allow price-like patterns
        # Prices look like: "19.50", "110,00", "50.00"
        is_price_like = re.match(r'^\d+[.,]\d{2}$', text.strip())
        
        if not is_price_like and not is_valid_text(text, min_length=2):
            print(f"DEBUG: Skipping invalid text (prob={prob:.2f}): '{text}'")
            continue
            
        filtered_results.append((bbox, text, prob))
    
    # Sort by Y-coordinate first
    # bbox is [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
    # we use top-left y (y1) for sorting
    sorted_res = sorted(filtered_results, key=lambda r: r[0][0][1])
    
    if not sorted_res:
        return []
        
    current_y = sorted_res[0][0][0][1]
    
    for res in sorted_res:
        bbox, text, prob = res
        tl_y = bbox[0][1]
        
        if abs(tl_y - current_y) <= y_tolerance:
            current_line.append(res)
        else:
            # Process completed line: sort by X
            current_line.sort(key=lambda r: r[0][0][0])
            line_text = " ".join([r[1] for r in current_line])
            lines.append(line_text)
            
            # Start new line
            current_line = [res]
            current_y = tl_y
            
    # Append last line
    if current_line:
        current_line.sort(key=lambda r: r[0][0][0])
        lines.append(" ".join([r[1] for r in current_line]))
        
    return lines

def extract_merchant(lines: List[str]) -> Optional[str]:
    """Extract merchant name from receipt, typically in first few lines"""
    if not lines:
        return None
        
    skip_words = [
        "RECEIPT", "TAX INVOICE", "INVOICE", "WELCOME", "COPY", "CUSTOMER", 
        "ORDER", "TABLE", "SERVER", "DATE", "TIME", "TEL", "FAX",
        "ABN", "VAT", "GST", "REG", "PH", "PHONE", "BRN", "LTD", "LIMITED",
        "HEALTHY", "FOODS"  # Common generic words
    ]
    
    candidates = []
    
    for i, line in enumerate(lines[:8]):  # Check first 8 lines
        clean_line = line.strip()
        if len(clean_line) < 3:
            continue
            
        upper_line = clean_line.upper()
        
        # Skip lines with skip words
        if any(word in upper_line for word in skip_words):
            continue
            
        # Skip lines with long numbers (IDs, phone numbers, etc.)
        if re.search(r'\d{7,}', clean_line):
            continue
        
        # Skip lines that are mostly numbers
        digit_count = sum(c.isdigit() for c in clean_line)
        if digit_count > len(clean_line) / 2:
            continue
            
        # Prefer lines with letters and reasonable length
        letter_count = sum(c.isalpha() for c in clean_line)
        if letter_count >= 3:
            # Score based on position (earlier is better) and letter count
            score = (10 - i) + (letter_count / len(clean_line)) * 5
            candidates.append((score, clean_line))
    
    if candidates:
        # Return highest scoring candidate
        candidates.sort(reverse=True, key=lambda x: x[0])
        return candidates[0][1]
    
    return None

def extract_date(text: str) -> Optional[str]:
    """Extract date from receipt text with multiple format support"""
    date_patterns = [
        # Standard formats
        (r'\d{4}-\d{2}-\d{2}', '%Y-%m-%d'),
        (r'\d{2}/\d{2}/\d{4}', '%d/%m/%Y'),
        (r'\d{2}/\d{2}/\d{2}', '%d/%m/%y'),
        (r'\d{2}-\d{2}-\d{4}', '%d-%m-%Y'),
        (r'\d{2}\.\d{2}\.\d{4}', '%d.%m.%Y'),
        (r'\d{2}\.\d{2}\.\d{2}', '%d.%m.%y'),  # Added for 21.01.26 format
        # Text formats
        (r'\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s\d{2,4}', '%d %b %Y'),
        (r'[A-Za-z]{3}\s\d{1,2}[\\s,.]+\d{4}', '%b %d %Y'),
    ]
    
    for pattern, fmt in date_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            date_str = match.group(0)
            try:
                # Handle both 2-digit and 4-digit years
                if fmt in ['%d/%m/%y', '%d.%m.%y']:
                    # Try both formats
                    for f in [fmt, fmt.replace('%y', '%Y')]:
                        try:
                            dt = datetime.strptime(date_str, f)
                            # If 2-digit year, assume 2000s
                            if dt.year < 100:
                                dt = dt.replace(year=dt.year + 2000)
                            return dt.strftime('%Y-%m-%d')
                        except ValueError:
                            continue
                else:
                    dt = datetime.strptime(date_str, fmt)
                    return dt.strftime('%Y-%m-%d')
            except:
                pass
    
    return None

def detect_itemized_section(lines: List[str]) -> tuple:
    """
    Detect the start and end of the itemized section in a receipt.
    Returns: (start_index, end_index)
    
    Strategy:
    - Header: First ~5-10 lines (merchant, address, BRN, Tel, etc.)
    - Items: Section with consistent price patterns
    - Footer: After "TOTAL" keyword
    """
    start_idx = 0
    end_idx = len(lines)
    
    # Keywords that indicate we're past the header and into items
    item_section_indicators = ["QTY", "DESCRIPTION", "ARTICLE", "ITEM"]
    
    # Keywords that indicate end of items section
    footer_keywords = ["TOTAL", "SUBTOTAL", "AMOUNT DUE", "GRAND TOTAL", "PAYMENT"]
    
    # Find start of itemized section
    # Skip first few lines (usually header: merchant, address, BRN, Tel, etc.)
    header_keywords = ["BRN", "TEL", "PHONE", "FAX", "ADDRESS", "VAT", "REG", "EMAIL", "WEB"]
    
    for i, line in enumerate(lines):
        upper_line = line.upper()
        
        # If we find item section indicators, start there
        if any(ind in upper_line for ind in item_section_indicators):
            start_idx = i + 1  # Start after the header row
            break
        
        # Skip lines with header keywords
        if any(kw in upper_line for kw in header_keywords):
            start_idx = i + 1
            continue
        
        # If we find a line with a price-like pattern after some text, items might start here
        # But only after we've seen at least 3 lines (to skip merchant/address)
        if i >= 3:
            parts = line.split()
            if len(parts) >= 2:
                # Check if last token looks like a price
                if re.match(r'^\d+[.,]\d{2}$', parts[-1]):
                    start_idx = i
                    break
    
    # Find end of itemized section (where TOTAL appears)
    for i, line in enumerate(lines):
        upper_line = line.upper()
        if any(kw in upper_line for kw in footer_keywords):
            end_idx = i
            break
    
    print(f"DEBUG: Detected itemized section from line {start_idx} to {end_idx}")
    if start_idx < len(lines):
        print(f"DEBUG: First item line: '{lines[start_idx]}'")
    if end_idx < len(lines):
        print(f"DEBUG: Total line: '{lines[end_idx]}'")
    
    return start_idx, end_idx

def extract_amount_and_items(lines: List[str]):
    """Extract total amount and itemized list from receipt"""
    items = []
    total_amount = None
    
    total_keywords = ["TOTAL", "AMOUNT DUE", "GRAND TOTAL", "BALANCE DUE", "PAYMENT", "NET", "AMOUNT"]
    invalid_item_keywords = [
        "SUBTOTAL", "TAX", "VAT", "GST", "CHANGE", "CASH", "VISA", "MASTERCARD", 
        "EFTPOS", "CARD", "DUE", "TEL:", "FAX:", "BRN:", "ADDRESS:", "EMAIL:", "WEB", 
        "THANK", "VISIT", "REG:", "PH:", "PHONE:", "NO.", "DATE:", "TIME:", "NAME:",
        "QTY", "DESCRIPTION", "AMOUNT", "ARTICLE"  # Table headers
    ]
    
    found_total = False
    
    # Detect where the itemized section is
    item_start, item_end = detect_itemized_section(lines)
    
    # Text buffer for multi-line items
    current_item_buffer = []
    
    for idx, line in enumerate(lines):
        clean_line = line.strip()
        upper_line = clean_line.upper()
        
        # Check for Total line
        is_total_line = any(kw in upper_line for kw in total_keywords)

        
        parts = clean_line.split()
        if not parts: 
            continue
            
        # Try to parse price from the last token, then second last
        # Pass context to avoid false positives
        price_val = fuzzy_parse_price(parts[-1], clean_line)
        price_token = parts[-1]
        
        if price_val is None and len(parts) > 1:
            price_val = fuzzy_parse_price(parts[-2], clean_line)
            price_token = parts[-2]
        
        if is_total_line:
            # Extract total amount
            if price_val is not None:
                if not found_total or (total_amount and price_val > total_amount):
                    total_amount = price_val
                    found_total = True
            current_item_buffer = []
            continue
        
        # SKIP LINES OUTSIDE THE ITEMIZED SECTION
        # This prevents header (merchant, address, BRN, Tel) and footer (metadata) from being treated as items
        if idx < item_start or idx >= item_end:
            continue

        # Skip invalid lines (metadata, headers, etc.)
        if any(kw in upper_line for kw in invalid_item_keywords):
            current_item_buffer = []
            continue
            
        # Skip date lines
        if extract_date(clean_line):
           current_item_buffer = []
           continue
        
        # ITEM EXTRACTION LOGIC
        if price_val is not None and price_val > 0:  # Must be positive price
            # Found a line with a price - finishes the current item
            
            print(f"DEBUG: Found price {price_val} in line: '{clean_line}'")
            print(f"DEBUG: Price token: '{price_token}'")
            print(f"DEBUG: Current buffer: {current_item_buffer}")
            
            # Extract item name from buffer + current line (minus price)
            if price_token in clean_line:
                current_line_text = clean_line[:clean_line.rfind(price_token)].strip()
            else:
                current_line_text = clean_line.replace(price_token, '').strip()
            
            print(f"DEBUG: Current line text (after removing price): '{current_line_text}'")
                
            # Combine buffer with current line
            full_item_text = " ".join(current_item_buffer + [current_line_text]).strip()
            print(f"DEBUG: Full item text (before cleanup): '{full_item_text}'")
            
            # Extract quantity if present (e.g., "3>", "1 x", "2)")
            quantity = 1
            quantity_match = re.match(r'^(\d+)\s*[x>.)\\]]\s*', full_item_text, re.IGNORECASE)
            if quantity_match:
                try:
                    quantity = int(quantity_match.group(1))
                except:
                    quantity = 1
            
            # Cleanup leading quantity/bullets
            full_item_text = re.sub(r'^[0-9]+[>.)\]]?\s*', '', full_item_text)
            full_item_text = re.sub(r'^[xX]\s*', '', full_item_text)
            
            # Cleanup noise characters
            full_item_text = full_item_text.lstrip('.,-_*~!').strip()
            
            # Only add if we have a meaningful, valid name
            if len(full_item_text) > 2 and not full_item_text.isdigit() and is_valid_text(full_item_text):
                items.append({
                    "name": full_item_text,
                    "price": str(price_val),
                    "quantity": quantity
                })
            else:
                print(f"DEBUG: Skipping invalid item name: '{full_item_text}' (price={price_val})")

            
            current_item_buffer = []
            
        else:
            # No price found - add to buffer for multi-line items
            # BUT: Limit buffer size to prevent combining entire receipt into one item
            # In table-format receipts, items are usually 1-2 lines max
            
            # Filter out very short noise lines and lines that look like headers
            if len(clean_line) > 1 and not any(kw in upper_line for kw in ["QTY", "DESCRIPTION", "PRICE", "AMOUNT"]):
                # Only keep last 2 lines in buffer to handle multi-line items
                # This prevents buffering the entire receipt
                current_item_buffer.append(clean_line)
                if len(current_item_buffer) > 2:
                    # Buffer is getting too long - this might be a table format
                    # Treat the oldest buffered line as a standalone item with unknown price
                    old_line = current_item_buffer.pop(0)
                    
                    # Check if it looks like a valid item name
                    if len(old_line) > 3 and is_valid_text(old_line):
                        print(f"DEBUG: Adding buffered item without price: '{old_line}'")
                        items.append({
                            "name": old_line,
                            "price": "0.00",  # Unknown price
                            "quantity": 1
                        })


    # Fallback for total if not found
    if total_amount is None and items:
        # Sum all item prices
        calc_sum = sum(float(i['price']) * i.get('quantity', 1) for i in items)
        total_amount = calc_sum

    return total_amount, items

def preprocess_image(image: Image.Image, save_debug=True) -> Image.Image:
    """
    Preprocess image for better OCR accuracy.
    
    Args:
        image: Input PIL Image
        save_debug: If True, save preprocessed image for debugging
    """
    # 1. Convert to grayscale
    img = image.convert('L')
    
    # 2. Enhance contrast (increased from 2.0 to 2.5 for better text clarity)
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(2.5)
    
    # 3. Enhance brightness slightly
    enhancer = ImageEnhance.Brightness(img)
    img = enhancer.enhance(1.1)
    
    # 4. Apply sharpening
    img = img.filter(ImageFilter.SHARPEN)
    
    # 5. Save debug image if requested
    if save_debug:
        try:
            import os
            debug_dir = "/tmp/receipt_debug"
            os.makedirs(debug_dir, exist_ok=True)
            debug_path = os.path.join(debug_dir, f"preprocessed_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg")
            img.save(debug_path)
            print(f"DEBUG: Preprocessed image saved to: {debug_path}")
        except Exception as e:
            print(f"DEBUG: Failed to save debug image: {e}")
    
    return img


def _doc_ai_to_scanned_receipt(extraction: dict) -> ScannedReceipt:
    """Map Document AI extraction dict to the ScannedReceipt response.

    Items are emitted with both the new structured fields (unit_price, amount)
    and a legacy `price` string so existing mobile clients keep working until
    they're updated to read the richer shape.
    """
    legacy_items = []
    for item in extraction.get("items", []):
        unit_price = item.get("unit_price")
        amount = item.get("amount")
        legacy_price = unit_price if unit_price is not None else amount
        legacy_items.append({
            "name": item.get("name"),
            "quantity": item.get("quantity") or 1,
            "unit_price": unit_price,
            "amount": amount,
            "price": f"{legacy_price:.2f}" if legacy_price is not None else "0.00",
            "confidence": item.get("confidence"),
        })

    return ScannedReceipt(
        merchant=extraction.get("merchant"),
        date=extraction.get("date"),
        amount=extraction.get("amount"),
        currency=extraction.get("currency"),
        tax=extraction.get("tax"),
        items=legacy_items,
        extraction_method="document_ai",
        overall_confidence=extraction.get("overall_confidence"),
        low_confidence_fields=extraction.get("low_confidence_fields", []),
    )


def _run_heuristic(image: Image.Image) -> ScannedReceipt:
    """Existing Cloud Vision -> EasyOCR + heuristic pipeline."""
    ocr_engine = "Google Vision"
    result = None

    if GOOGLE_VISION_AVAILABLE and os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            print("--- DEBUG: STARTING SCAN (Google Cloud Vision) ---")
            result = run_google_vision_ocr(image)
            print(f"DEBUG: Google Vision found {len(result)} total text elements")
        except Exception as vision_error:
            print(f"DEBUG: Google Vision failed: {vision_error}")
            print("DEBUG: Falling back to EasyOCR")
            ocr_engine = "EasyOCR (fallback)"
            result = None

    if result is None:
        print("--- DEBUG: STARTING SCAN (EasyOCR - English + French) ---")
        reader = get_easyocr_reader()
        image_bytes = io.BytesIO()
        image.save(image_bytes, format='JPEG')
        image_bytes = image_bytes.getvalue()
        result = reader.readtext(image_bytes, detail=1)
        print(f"DEBUG: EasyOCR found {len(result)} total text elements")
        ocr_engine = "EasyOCR (fallback)"

    lines = group_text_by_lines(result)
    print(f"DEBUG: After filtering, {len(lines)} valid lines remain")
    full_text = "\n".join(lines)
    print(f"--- DEBUG: RECONSTRUCTED LINES START ---\n{full_text}\n--- DEBUG: RECONSTRUCTED LINES END ---")

    merchant = extract_merchant(lines)
    print(f"DEBUG: Extracted Merchant: {merchant}")
    date = extract_date(full_text)
    print(f"DEBUG: Extracted Date: {date}")
    amount, items = extract_amount_and_items(lines)
    print(f"DEBUG: Extracted Amount: {amount}")
    print(f"DEBUG: Extracted Items: {items}")

    method = "vision_heuristic" if ocr_engine == "Google Vision" else "easyocr_heuristic"
    return ScannedReceipt(
        merchant=merchant,
        date=date,
        amount=amount,
        items=items,
        extraction_method=method,
    )


def _merge_doc_ai_into_heuristic(
    doc_ai: dict, heuristic: ScannedReceipt
) -> ScannedReceipt:
    """When Doc AI's overall confidence misses the bar but individual
    fields are good, prefer Doc AI per-field when its confidence ≥ 0.5
    and fall back to heuristic otherwise. This is significantly better
    than discarding Doc AI entirely on a single low-confidence field.
    """
    field_conf = doc_ai.get("field_confidences", {}) or {}
    per_field_threshold = 0.5

    def use_doc_ai(field: str) -> bool:
        return (field_conf.get(field) or 0) >= per_field_threshold and doc_ai.get(field) is not None

    merged_merchant = doc_ai.get("merchant") if use_doc_ai("merchant") else heuristic.merchant
    merged_date = doc_ai.get("date") if use_doc_ai("date") else heuristic.date
    merged_amount = doc_ai.get("amount") if use_doc_ai("amount") else heuristic.amount
    merged_currency = doc_ai.get("currency") or heuristic.currency
    merged_tax = doc_ai.get("tax") if doc_ai.get("tax") is not None else heuristic.tax

    # Items: prefer Doc AI's list if it has any items; otherwise heuristic's.
    doc_ai_items = doc_ai.get("items") or []
    if doc_ai_items:
        legacy_items = []
        for item in doc_ai_items:
            unit_price = item.get("unit_price")
            amount_v = item.get("amount")
            legacy_price = unit_price if unit_price is not None else amount_v
            legacy_items.append({
                "name": item.get("name"),
                "quantity": item.get("quantity") or 1,
                "unit_price": unit_price,
                "amount": amount_v,
                "price": f"{legacy_price:.2f}" if legacy_price is not None else "0.00",
                "confidence": item.get("confidence"),
            })
        merged_items = legacy_items
    else:
        merged_items = heuristic.items or []

    return ScannedReceipt(
        merchant=merged_merchant,
        date=merged_date,
        amount=merged_amount,
        currency=merged_currency,
        tax=merged_tax,
        items=merged_items,
        extraction_method="document_ai",
        overall_confidence=doc_ai.get("overall_confidence"),
        low_confidence_fields=doc_ai.get("low_confidence_fields", []),
        receipt_image_url=heuristic.receipt_image_url,
    )


def _log_shadow_diff(doc_ai: Optional[dict], heuristic: ScannedReceipt) -> None:
    """Side-by-side comparison logged to stdout for the shadow-mode rollout."""
    payload = {
        "shadow_diff": {
            "document_ai": doc_ai,
            "heuristic": heuristic.model_dump(),
        }
    }
    try:
        print(f"DOC_AI_SHADOW {json.dumps(payload, default=str)}")
    except Exception as e:
        logger.debug("shadow diff log failed: %s", e)


def _persist_receipt(contents: bytes, mime_type: str) -> Optional[str]:
    """Save the uploaded receipt image via the configured storage backend
    and return its URL, or None on failure.

    Local-storage URL shape: `/uploads/receipts/{uuid}.{ext}`.
    S3/GCS: absolute https URL (once STORAGE_TYPE flips).

    Failure is non-fatal — the scan still returns parsed fields. We just
    can't show the original later. Mobile renders a placeholder.
    """
    try:
        import uuid as _uuid
        from services.storage_service import get_storage_service

        ext_map = {
            "image/jpeg": "jpg", "image/jpg": "jpg",
            "image/png": "png", "image/webp": "webp", "image/heic": "heic",
        }
        ext = ext_map.get(mime_type.lower(), "jpg")
        filename = f"{_uuid.uuid4()}.{ext}"

        storage = get_storage_service()
        return storage.upload_bytes(
            contents,
            filename=filename,
            content_type=mime_type,
            folder="receipts",
        )
    except Exception as e:
        logger.warning("Receipt image persistence failed (non-fatal): %s", e)
        return None


@router.post("/purchases/scan", response_model=ScannedReceipt)
async def scan_receipt(file: UploadFile = File(...)):
    """Scan receipt image and extract merchant, date, amount, and items.

    Side effect: the uploaded image is persisted via storage_service so the
    mobile client can thread the URL through to POST /purchase and render
    the original receipt later. Persistence failure is non-fatal.

    Routing:
      DOC_AI_ENABLED=false                    -> heuristic only (legacy)
      DOC_AI_ENABLED=true, SHADOW_MODE=true   -> call both, log diff, return heuristic
      DOC_AI_ENABLED=true, SHADOW_MODE=false  -> Document AI; fall back to heuristic
                                                 on error or confidence < threshold
    """
    try:
        contents = await file.read()
        mime_type = file.content_type or "image/jpeg"

        # Persist the original image. Done up-front so both Doc AI and
        # heuristic paths return the URL on the response without each
        # having to remember to set it.
        receipt_url = _persist_receipt(contents, mime_type)

        doc_ai_extraction: Optional[dict] = None
        if document_ai_service.is_enabled():
            doc_ai_extraction = document_ai_service.extract_expense(contents, mime_type)
            if doc_ai_extraction is not None:
                print(
                    f"DEBUG: Document AI overall_confidence="
                    f"{doc_ai_extraction.get('overall_confidence', 0):.2f}, "
                    f"low_fields={doc_ai_extraction.get('low_confidence_fields', [])}"
                )

        # Production mode: trust Document AI if confident enough.
        if (
            doc_ai_extraction is not None
            and not document_ai_service.is_shadow_mode()
            and (doc_ai_extraction.get("overall_confidence") or 0) >= document_ai_service.min_confidence()
        ):
            result = _doc_ai_to_scanned_receipt(doc_ai_extraction)
            result.receipt_image_url = receipt_url
            return result

        # Otherwise run the heuristic pipeline.
        image = Image.open(io.BytesIO(contents))
        image = preprocess_image(image)
        heuristic = _run_heuristic(image)
        heuristic.receipt_image_url = receipt_url

        # Shadow mode: log side-by-side, return heuristic.
        if doc_ai_extraction is not None and document_ai_service.is_shadow_mode():
            _log_shadow_diff(doc_ai_extraction, heuristic)
            return heuristic

        # Doc AI ran but missed the overall-confidence bar — merge per-field
        # instead of discarding it entirely. Significantly more accurate
        # than either source alone for typical low/mixed-confidence receipts.
        if doc_ai_extraction is not None:
            return _merge_doc_ai_into_heuristic(doc_ai_extraction, heuristic)

        return heuristic

    except Exception as e:
        print(f"OCR Error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to process image: {str(e)}")
