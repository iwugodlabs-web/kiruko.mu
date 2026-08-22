from sqlalchemy.orm import Session
from core.model import Leave as LeaveORM, PrivateUser, User
from schema.user_schema import CreateLeave as LeaveSchema
from schema.job_schema import ApproveLeaveRequest
from typing import List, Optional
from datetime import datetime
from fastapi import HTTPException
import logging

def create_leave(leave_data: LeaveSchema, db: Session) -> LeaveORM:
    """Create a new leave record"""
    leave = LeaveORM(
        **leave_data.dict(),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow()
    )
    db.add(leave)
    db.commit()
    db.refresh(leave)
    return leave

def get_leave_by_id(leave_id: int, db: Session) -> Optional[LeaveORM]:
    """Get a leave by its ID"""
    return db.query(LeaveORM).filter(LeaveORM.leave_id == leave_id).first()

def get_leaves_by_user(private_user_id: int, db: Session) -> List[LeaveORM]:
    """Get all leaves for a specific user"""
    return db.query(LeaveORM).filter(LeaveORM.private_user_id == private_user_id).order_by(LeaveORM.start_date.desc()).all()

def get_all_leaves(db: Session) -> List[LeaveORM]:
    """Get all leaves"""
    return db.query(LeaveORM).order_by(LeaveORM.created_at.desc()).all()

def get_all_leaves_with_requester(db: Session) -> List[dict]:
    """Get all leaves with requester information"""
    leaves = db.query(LeaveORM).order_by(LeaveORM.created_at.desc()).all()
    
    result = []
    for leave in leaves:
        # Get requester name from private_user
        private_user = db.query(PrivateUser).filter(
            PrivateUser.private_user_id == leave.private_user_id
        ).first()
        
        requester_name = "Unknown"
        requester_email = None
        
        if private_user:
            first = private_user.first_name or ''
            last = private_user.last_name or ''
            requester_name = f"{first} {last}".strip()
            
            # Get email from User table
            user = db.query(User).filter(User.user_id == private_user.user_id).first()
            if user:
                requester_email = user.email
                if not requester_name:
                    requester_name = user.email or "Unknown"
        
        leave_dict = {
            'leave_id': leave.leave_id,
            'private_user_id': leave.private_user_id,
            'leave_type': leave.leave_type,
            'start_date': leave.start_date,
            'end_date': leave.end_date,
            'status': leave.status,
            'notes': leave.notes,
            'reason': leave.notes,
            'requester_name': requester_name,
            'requester_email': requester_email,
            'approved_by': leave.approved_by,
            'approved_at': leave.approved_at,
            'rejection_reason': leave.rejection_reason,
            'approver_comments': leave.approver_comments,
            'created_at': leave.created_at,
            'updated_at': leave.updated_at
        }
        result.append(leave_dict)
    
    return result

def get_leaves_by_company(company_id: int, db: Session) -> List[LeaveORM]:
    """Get all leaves for a specific company"""
    return db.query(LeaveORM).join(LeaveORM.private_user).filter(PrivateUser.company_id == company_id).order_by(LeaveORM.created_at.desc()).all()

def update_leave(leave_id: int, update_data: dict, db: Session) -> Optional[LeaveORM]:
    """Update a leave record"""
    leave = db.query(LeaveORM).filter(LeaveORM.leave_id == leave_id).first()
    if not leave:
        return None
    for key, value in update_data.items():
        setattr(leave, key, value)
    leave.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(leave)
    return leave

def delete_leave(leave_id: int, db: Session) -> bool:
    """Delete a leave record"""
    leave = db.query(LeaveORM).filter(LeaveORM.leave_id == leave_id).first()
    if not leave:
        return False
    db.delete(leave)
    db.commit()
    return True

def approve_or_reject_leave(leave_id: int, action: str, rejection_reason: Optional[str], approver_comments: Optional[str], approver_user_id: int, db: Session) -> Optional[LeaveORM]:
    """Approve or reject a leave request"""
    try:
        leave = db.query(LeaveORM).filter(LeaveORM.leave_id == leave_id).first()
        if not leave:
            raise HTTPException(status_code=404, detail="Leave request not found")

        if leave.status != 'pending':
            raise HTTPException(status_code=400, detail="Leave request has already been processed")

        # Update the leave with approval/rejection details
        if action == 'approve':
            leave.status = 'approved'
            leave.approved_by = approver_user_id
            leave.approved_at = datetime.utcnow()
            leave.approver_comments = approver_comments
        elif action == 'reject':
            if not rejection_reason:
                raise HTTPException(status_code=400, detail="Rejection reason is required")
            leave.status = 'rejected'
            leave.approved_by = approver_user_id
            leave.approved_at = datetime.utcnow()
            leave.rejection_reason = rejection_reason
            leave.approver_comments = approver_comments
        else:
            raise HTTPException(status_code=400, detail="Invalid action. Must be 'approve' or 'reject'")

        leave.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(leave)
        return leave

    except HTTPException:
        raise
    except Exception as e:
        logging.error(f"Error processing leave approval/rejection: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to process leave request")

def get_leaves_by_company_with_requester(company_id: int, db: Session) -> List[dict]:
    """Get all leaves for a specific company with requester information.
    Matches employees by private_user.company_id OR job.company_id OR job.employer_brn.
    """
    from core.model import Job, Company
    try:
        # Get company BRN for matching via job.employer_brn
        company = db.query(Company).filter(Company.company_id == company_id).first()
        company_brn = company.brn if company else None

        # Build list of private_user_ids that belong to this company
        # Method 1: PrivateUser.company_id matches
        direct_user_ids = db.query(PrivateUser.private_user_id).filter(
            PrivateUser.company_id == company_id
        ).all()
        direct_user_ids = {u[0] for u in direct_user_ids}

        # Method 2: Job.company_id matches
        job_company_ids = db.query(Job.private_user_id).filter(
            Job.company_id == company_id
        ).all()
        job_company_ids = {u[0] for u in job_company_ids if u[0]}

        # Method 3: Job.employer_brn matches
        job_brn_ids = set()
        if company_brn:
            job_brn_results = db.query(Job.private_user_id).filter(
                Job.employer_brn == company_brn
            ).all()
            job_brn_ids = {u[0] for u in job_brn_results if u[0]}

        # Combine all matching private_user_ids
        all_user_ids = direct_user_ids | job_company_ids | job_brn_ids

        if not all_user_ids:
            return []

        # Fetch leaves for all matching users
        leaves = db.query(LeaveORM).filter(
            LeaveORM.private_user_id.in_(all_user_ids)
        ).order_by(LeaveORM.created_at.desc()).all()

        result = []
        for leave in leaves:
            # Get requester name - need to load private_user and user
            private_user = db.query(PrivateUser).filter(
                PrivateUser.private_user_id == leave.private_user_id
            ).first()
            
            requester_name = "Unknown"
            requester_email = None
            
            if private_user:
                # Build name from first_name and last_name
                first = private_user.first_name or ''
                last = private_user.last_name or ''
                requester_name = f"{first} {last}".strip()
                
                # Get email from User table
                user = db.query(User).filter(User.user_id == private_user.user_id).first()
                if user:
                    requester_email = user.email
                    # If name is still empty, use email
                    if not requester_name:
                        requester_name = user.email or "Unknown"

            leave_dict = {
                'leave_id': leave.leave_id,
                'private_user_id': leave.private_user_id,
                'leave_type': leave.leave_type,
                'start_date': leave.start_date,
                'end_date': leave.end_date,
                'status': leave.status,
                'notes': leave.notes,  # Include original notes field
                'reason': leave.notes,  # Map notes to reason for frontend compatibility
                'requester_name': requester_name,
                'requester_email': requester_email,
                'approved_by': leave.approved_by,
                'approved_at': leave.approved_at,
                'rejection_reason': leave.rejection_reason,
                'approver_comments': leave.approver_comments,
                'created_at': leave.created_at,
                'updated_at': leave.updated_at
            }
            result.append(leave_dict)

        return result

    except Exception as e:
        logging.error(f"Error fetching leaves by company: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch leave requests")