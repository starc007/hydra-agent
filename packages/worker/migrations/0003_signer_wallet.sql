-- Add signer_wallet column. Existing rows carry signer = owner (the only wallet we knew).
ALTER TABLE users ADD COLUMN signer_wallet TEXT NOT NULL DEFAULT '';
UPDATE users SET signer_wallet = wallet WHERE signer_wallet = '';
CREATE INDEX IF NOT EXISTS idx_users_signer_wallet ON users(signer_wallet);
