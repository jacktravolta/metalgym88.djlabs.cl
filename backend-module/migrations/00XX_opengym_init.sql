-- metalgym88 heart (T6a placeholder): the gym state document store needs NO tables
-- (files under opengym.storage_dir). This migration only seeds the AI operation
-- tariff that T6b wires into /opengym/ai. Follow your platform's migration style
-- if it differs (see migration 005 for the tariffs table definition).
-- The owner tunes credits_cost: it is the per-operation price of the paid feature.

INSERT INTO tariffs (operation, credits_cost, is_active, valid_from, valid_until)
VALUES ('gym_ai_chat', 5, 1, NOW(), NULL);
