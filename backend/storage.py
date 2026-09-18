"""Project-local SQLite audit log. Queries are parameterized and stores are scoped."""
import json
import sqlite3
from contextlib import closing
from .rag import ROOT

DEFAULT_DB = ROOT / "data/runs.sqlite3"

def connect(db_path=DEFAULT_DB):
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=10)
    connection.execute("""CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, store_id TEXT NOT NULL, created_at TEXT NOT NULL, report_json TEXT NOT NULL
    )""")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_runs_store_time ON runs(store_id, created_at DESC)")
    return connection

def save(report, db_path=DEFAULT_DB):
    with closing(connect(db_path)) as conn, conn:
        conn.execute("INSERT INTO runs(id,store_id,created_at,report_json) VALUES (?,?,?,?)",
                     (report["id"], report["storeId"], report["createdAt"], json.dumps(report, ensure_ascii=False)))

def history(store_id, limit=20, db_path=DEFAULT_DB):
    with closing(connect(db_path)) as conn, conn:
        rows = conn.execute("SELECT report_json FROM runs WHERE store_id=? ORDER BY created_at DESC LIMIT ?",
                            (store_id, max(1, min(int(limit), 50)))).fetchall()
    return [json.loads(row[0]) for row in rows]


def connect_replenishment(db_path=DEFAULT_DB):
    conn = connect(db_path)
    conn.execute("""CREATE TABLE IF NOT EXISTS replenishment_runs (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, report_json TEXT NOT NULL
    )""")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_replenishment_time ON replenishment_runs(created_at DESC)")
    return conn


def save_replenishment(report, db_path=DEFAULT_DB):
    with closing(connect_replenishment(db_path)) as conn, conn:
        conn.execute("INSERT INTO replenishment_runs VALUES (?,?,?)",
                     (report["id"], report["createdAt"], json.dumps(report, ensure_ascii=False)))


def replenishment_history(limit=10, db_path=DEFAULT_DB):
    with closing(connect_replenishment(db_path)) as conn, conn:
        rows = conn.execute("SELECT report_json FROM replenishment_runs ORDER BY created_at DESC, rowid DESC LIMIT ?",
                            (max(1, min(int(limit), 50)),)).fetchall()
    return [json.loads(row[0]) for row in rows]
