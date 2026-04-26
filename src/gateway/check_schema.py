import sqlite3
conn = sqlite3.connect('registry.db')
print(conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='mapping_blueprints';").fetchone()[0])
