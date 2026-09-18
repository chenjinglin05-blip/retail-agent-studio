"""Independent skill entry point; manifest chooses only allowlisted read-only tools."""
import argparse
import json
from pathlib import Path
from backend.tools import call_tool
parser = argparse.ArgumentParser()
manifest = json.loads((Path(__file__).parent / "registry.json").read_text(encoding="utf-8"))
parser.add_argument("skill", choices=list(manifest))
parser.add_argument("--store", default="GZ001")
parser.add_argument("--query", default="库存补货")
args = parser.parse_args()
item = manifest[args.skill]
kwargs = {"store_id": args.store} if item["input"] == "store_id" else {"query": args.query}
print(json.dumps(call_tool(item["tool"], **kwargs), ensure_ascii=False, indent=2))
