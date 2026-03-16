import mysql.connector
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib

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
WHERE ds.status='completed'
"""

df = pd.read_sql(query, db)

db.close()

X = df[[
"total_fish",
"drying_time_minutes",
"total_fully_dried",
"total_partially_dried",
"total_not_dried"
]]

y = df["extension_minutes"]

model = RandomForestRegressor(
    n_estimators=300,
    max_depth=10,
    random_state=42
)

model.fit(X,y)

joblib.dump(model,"drying_model.pkl")

print("Random Forest trained from database")