from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core import config
from core.model import User
from core.dependencies import get_current_user
from db_models.crud.financials import get_financials_by_user_id
from schema.user_schema import FinancialsData

router = APIRouter(
    prefix="/financials",
    tags=['Financials']
)

@router.get('/user/{private_user_id}', response_model=FinancialsData)
async def get_user_financials(
    private_user_id: int,
    db: Session = Depends(config.get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.private_user.private_user_id != private_user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access your own financial data."
        )
    
    financials = get_financials_by_user_id(db, private_user_id)
    return financials