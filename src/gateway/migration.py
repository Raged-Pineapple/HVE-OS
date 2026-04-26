import db_service
import sys

def main():
    try:
        with db_service.get_cursor() as cur:
            cur.execute("ALTER TABLE mapping_blueprints ADD COLUMN nested_explode BOOLEAN DEFAULT TRUE;")
            print("Successfully added nested_explode column.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
