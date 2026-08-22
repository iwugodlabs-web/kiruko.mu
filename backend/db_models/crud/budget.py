from sqlalchemy.orm import Session
from core.model import BudgetGoal
from schema.user_schema import CreateBudgetGoal
from typing import List, Optional


def create_budget_goal(data: CreateBudgetGoal, db: Session) -> BudgetGoal:
    goal = BudgetGoal(
        private_user_id=data.private_user_id,
        category=data.category,
        monthly_limit=data.monthly_limit,
        currency=data.currency,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def get_budget_goals_by_user(private_user_id: int, db: Session) -> List[BudgetGoal]:
    return db.query(BudgetGoal).filter(BudgetGoal.private_user_id == private_user_id).all()


def update_budget_goal(budget_id: int, update_data: dict, db: Session) -> Optional[BudgetGoal]:
    goal = db.query(BudgetGoal).filter(BudgetGoal.budget_id == budget_id).first()
    if not goal:
        return None
    for key, value in update_data.items():
        setattr(goal, key, value)
    db.commit()
    db.refresh(goal)
    return goal


def delete_budget_goal(budget_id: int, db: Session) -> bool:
    goal = db.query(BudgetGoal).filter(BudgetGoal.budget_id == budget_id).first()
    if not goal:
        return False
    db.delete(goal)
    db.commit()
    return True
