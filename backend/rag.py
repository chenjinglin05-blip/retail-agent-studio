"""Chinese bigram BM25 retrieval; no external service or hidden embedding model."""
import json
import math
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data/retail.json").read_text(encoding="utf-8"))

def grams(text):
    result = []
    for run in re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]+", text.lower()):
        result.extend([run[i:i+2] for i in range(len(run)-1)] if re.fullmatch(r"[\u4e00-\u9fff]+", run) else [run])
    return result

def retrieve(query, enhanced=True, limit=3):
    documents = [grams(d["title"] + " " + d["content"] + " " + " ".join(d["keywords"])) for d in DATA["knowledge"]]
    average = sum(map(len, documents)) / len(documents)
    result = []
    for i, doc in enumerate(DATA["knowledge"]):
        score = sum(word in query.lower() for word in doc["keywords"]) * 4
        if enhanced:
            counts = Counter(documents[i])
            for token in set(grams(query)):
                freq = counts[token]
                if not freq:
                    continue
                df = sum(token in other for other in documents)
                idf = math.log(1 + (len(documents) - df + .5) / (df + .5))
                score += idf * (freq * 2.2) / (freq + 1.2 * (.25 + .75 * len(documents[i]) / average))
        score = round(score, 2)
        if score >= (2.4 if enhanced else 1):
            result.append(dict(doc, score=score))
    return sorted(result, key=lambda d: (-d["score"], d["id"]))[:limit]
