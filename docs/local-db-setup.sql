-- 顧客テーブルの作成 (ローカル専用)
CREATE TABLE IF NOT EXISTS customers (
    customer_uuid TEXT PRIMARY KEY,
    customer_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT
);

-- サンプルデータの登録
INSERT OR REPLACE INTO customers (customer_uuid, customer_name, email, phone)
VALUES 
('c8b4fd4a-f5e9-4e78-be7b-8b5fb0f75a61', '山田 太郎', 'yamada.taro@example.com', '090-1234-5678'),
('de12ab34-56cd-78ef-90ab-1234567890ab', '佐藤 美咲', 'sato.misaki@example.com', '080-9876-5432');
