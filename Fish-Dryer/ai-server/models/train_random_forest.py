import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib

data = pd.read_csv("drying_sessions.csv")

X = data[["fully_dried","partially_dried","not_dried","color_index","texture_index"]]

y = data[["extend_minutes","temperature","fan_speed"]]

model = RandomForestRegressor(n_estimators=100)

model.fit(X,y)

joblib.dump(model,"models/random_forest.pkl")

print("Random forest trained")