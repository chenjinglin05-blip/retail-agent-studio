"""Generate a local evaluation report in the ignored outputs directory."""
import json
from pathlib import Path
from backend.agent import evaluate
from backend.rag import DATA

report = evaluate()
report["datasetVersion"] = DATA["version"]
target = Path(__file__).resolve().parents[1] / "outputs/evaluation-report.json"
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({k: v for k, v in report.items() if k != "rows"}, ensure_ascii=False, indent=2))
