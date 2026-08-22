#!/usr/bin/env python3
"""
Alembic migration management script for the Ivor Mobile backend
"""

import sys
import os

# Add the backend directory to Python path
backend_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_dir)

def run_alembic_command(command_args):
    """Run an alembic command with proper error handling"""
    try:
        from alembic.config import Config
        from alembic import command
        
        # Create alembic config
        alembic_cfg = Config("alembic.ini")
        
        if command_args[0] == "revision":
            # Create a new revision
            message = command_args[1] if len(command_args) > 1 else "Auto-generated migration"
            autogenerate = "--autogenerate" in command_args
            command.revision(alembic_cfg, message=message, autogenerate=autogenerate)
            
        elif command_args[0] == "upgrade":
            # Upgrade to specified revision (or "head")
            revision = command_args[1] if len(command_args) > 1 else "head"
            command.upgrade(alembic_cfg, revision)
            
        elif command_args[0] == "downgrade":
            # Downgrade to specified revision
            revision = command_args[1] if len(command_args) > 1 else "-1"
            command.downgrade(alembic_cfg, revision)
            
        elif command_args[0] == "current":
            # Show current revision
            command.current(alembic_cfg)
            
        elif command_args[0] == "history":
            # Show revision history
            command.history(alembic_cfg)
            
        elif command_args[0] == "init":
            # Initialize alembic (already done)
            print("Alembic is already initialized!")
            
        else:
            print(f"Unknown command: {command_args[0]}")
            print_help()
            
    except ImportError:
        print("❌ Alembic not installed. Run: pip install alembic")
        return False
    except Exception as e:
        print(f"❌ Error running alembic command: {e}")
        return False
        
    return True

def print_help():
    """Print usage help"""
    print("""
=== Alembic Migration Manager ===

Available commands:

1. Create a new migration:
   python manage_migrations.py revision "Add job history table" --autogenerate

2. Apply migrations:
   python manage_migrations.py upgrade

3. Rollback migrations:
   python manage_migrations.py downgrade

4. Show current revision:
   python manage_migrations.py current

5. Show migration history:
   python manage_migrations.py history

Examples:
   # Create migration for JobHistory table
   python manage_migrations.py revision "Add job history table" --autogenerate
   
   # Apply all pending migrations
   python manage_migrations.py upgrade
   
   # Rollback one migration
   python manage_migrations.py downgrade -1
""")

def create_job_history_migration():
    """Create a specific migration for JobHistory table"""
    print("Creating JobHistory migration...")
    
    try:
        from alembic.config import Config
        from alembic import command
        
        alembic_cfg = Config("alembic.ini")
        command.revision(
            alembic_cfg, 
            message="Add job history table for tracking job changes",
            autogenerate=True
        )
        
        print("✅ JobHistory migration created successfully!")
        print("Run 'python manage_migrations.py upgrade' to apply it.")
        
    except Exception as e:
        print(f"❌ Error creating migration: {e}")
        print("💡 Make sure database dependencies are installed: pip install -r requirement.txt")

if __name__ == "__main__":
    print("=== Ivor Mobile - Alembic Migration Manager ===")
    
    if len(sys.argv) < 2:
        print_help()
        sys.exit(1)
    
    command_args = sys.argv[1:]
    
    # Special command for creating JobHistory migration
    if command_args[0] == "create-job-history":
        create_job_history_migration()
    else:
        success = run_alembic_command(command_args)
        if not success:
            sys.exit(1)
