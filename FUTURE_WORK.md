# Future Work & Unfinished Use Cases

While this demonstration environment showcases hybrid search and transactional/analytical capabilities, the following predictive AI components are planned for future integration:

## 1. Predictive Anomaly Detection via TimesFM
- **Goal:** Implement time-series forecasting using the `TimesFM` model deployed in AlloyDB AI.
- **Scope:** Predict future transaction volumes and flag outlier transactions that deviate from baseline predictions.
- **Next Step:** Align the SQL definitions for `ai.forecast` and trigger bindings with the `transactions_25_26` table partitioning strategies.
