-- ============================================
-- USDT 管理系统 v3 - 数据库升级脚本
-- 在 Supabase SQL Editor 中执行
-- ============================================

-- 1. 交易簿表
CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. 给 transactions 表添加 ledger_id 列（如果还没有）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='ledger_id') THEN
    ALTER TABLE transactions ADD COLUMN ledger_id TEXT DEFAULT '';
  END IF;
END $$;

-- 3. 附件表
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  file_type TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. RLS 策略
ALTER TABLE ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ledgers' AND policyname='ledgers_select') THEN
    CREATE POLICY "ledgers_select" ON ledgers FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ledgers' AND policyname='ledgers_insert') THEN
    CREATE POLICY "ledgers_insert" ON ledgers FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ledgers' AND policyname='ledgers_update') THEN
    CREATE POLICY "ledgers_update" ON ledgers FOR UPDATE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ledgers' AND policyname='ledgers_delete') THEN
    CREATE POLICY "ledgers_delete" ON ledgers FOR DELETE USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attachments' AND policyname='att_select') THEN
    CREATE POLICY "att_select" ON attachments FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attachments' AND policyname='att_insert') THEN
    CREATE POLICY "att_insert" ON attachments FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attachments' AND policyname='att_delete') THEN
    CREATE POLICY "att_delete" ON attachments FOR DELETE USING (true);
  END IF;
END $$;

-- 5. 实时订阅
ALTER PUBLICATION supabase_realtime ADD TABLE ledgers;

-- ============================================
-- 执行完毕后，还需要创建 Storage Bucket（见 README）
-- ============================================
