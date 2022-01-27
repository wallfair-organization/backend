BEGIN;
CREATE TABLE IF NOT EXISTS casino_rewards (ID SERIAL PRIMARY KEY, userId varchar(255) NOT NULL, refId varchar(255), tradeId int, gameId varchar(255), type varchar(255), amount NUMERIC, created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP, UNIQUE (tradeId, type));
COMMIT;
