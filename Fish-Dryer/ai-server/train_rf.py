import mysql.connector
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib

# ===== CONNECT DATABASE =====
db = mysql.connector.connect(
    host="localhost",
    user="root",
    password="",
    database="fish-dryer"
)

query = """
SELECT
ds.total_fish,
ds.drying_time_minutes,
ds.extension_minutes,
cs.total_fully_dried,
cs.total_partially_dried,
cs.total_not_dried
FROM capture_sessions cs
JOIN drying_batches db ON db.id = cs.drying_batch_id
JOIN drying_sessions ds ON ds.id = db.drying_session_id
"""

# ===== LOAD DATA =====
df = pd.read_sql(query, db)
db.close()

print("Rows from DB:", len(df))

# ===== HANDLE EMPTY DATABASE =====
if len(df) == 0:
    print("⚠ No data found in DB — generating sample data...")

    data = []

    for total_fish in range(5, 21):  # 5 to 20 fish
        for time in range(30, 241, 30):  # 30 to 240 mins

            dried = int((time / 240) * total_fish)
            not_dried = total_fish - dried
            partial = 0

            remaining = max(0, 240 - time)

            data.append([
                total_fish,
                time,
                dried,
                partial,
                not_dried,
                remaining
            ])

    df = pd.DataFrame(data, columns=[
        "total_fish",
        "drying_time_minutes",
        "total_fully_dried",
        "total_partially_dried",
        "total_not_dried",
        "extension_minutes"
    ])

# ===== CLEAN =====
df = df.dropna()

print("Final dataset size:", len(df))

# ===== FEATURES =====
X = df[[
    "total_fish",
    "drying_time_minutes",
    "total_fully_dried",
    "total_partially_dried",
    "total_not_dried"
]]

y = df["extension_minutes"]

# ===== TRAIN =====
model = RandomForestRegressor(
    n_estimators=300,
    max_depth=10,
    random_state=42
)

model.fit(X, y)

# ===== SAVE =====
joblib.dump(model, "drying_model.pkl")

print("✅ Random Forest trained successfully")