const express = require('express');
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// config.iniから環境名とリージョンをロード
let awsConfig = { region: 'ap-northeast-1' };
let envName = 'prod';
try {
  const fsSync = require('fs');
  const configContent = fsSync.readFileSync(path.join(__dirname, '../config.ini'), 'utf-8');
  const regionMatch = configContent.match(/aws_region\s*=\s*(.+)/);
  const envMatch = configContent.match(/env_name\s*=\s*(.+)/);
  if (regionMatch) awsConfig.region = regionMatch[1].trim();
  if (envMatch) envName = envMatch[1].trim();
} catch (err) {
  console.warn("Could not load config.ini, using default ap-northeast-1 / prod");
}

const client = new DynamoDBClient(awsConfig);
const docClient = DynamoDBDocumentClient.from(client);

const INVENTORY_TABLE = `${envName}-inventory`;
const SALES_TABLE = `${envName}-sales`;

// ローカルデータベース (顧客用JSONファイル) のパス
const LOCAL_DB_PATH = path.join(__dirname, 'data', 'customers.json');

// 初期顧客データのロード/作成
function initLocalDB() {
  const fsSync = require('fs');
  const dir = path.dirname(LOCAL_DB_PATH);
  if (!fsSync.existsSync(dir)) {
    fsSync.mkdirSync(dir, { recursive: true });
  }
  if (!fsSync.existsSync(LOCAL_DB_PATH)) {
    const initialCustomers = [
      {
        customer_uuid: "c8b4fd4a-f5e9-4e78-be7b-8b5fb0f75a61",
        customer_name: "山田 太郎",
        email: "yamada.taro@example.com",
        phone: "090-1234-5678"
      },
      {
        customer_uuid: "de12ab34-56cd-78ef-90ab-1234567890ab",
        customer_name: "佐藤 美咲",
        email: "sato.misaki@example.com",
        phone: "080-9876-5432"
      }
    ];
    fsSync.writeFileSync(LOCAL_DB_PATH, JSON.stringify(initialCustomers, null, 2), 'utf-8');
  }
}
initLocalDB();

// ローカル顧客データの取得ヘルパー
function getLocalCustomers() {
  const fsSync = require('fs');
  try {
    const data = fsSync.readFileSync(LOCAL_DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// ローカル顧客データの書き込みヘルパー
function saveLocalCustomers(customers) {
  const fsSync = require('fs');
  fsSync.writeFileSync(LOCAL_DB_PATH, JSON.stringify(customers, null, 2), 'utf-8');
}

// 1. [AWS] 在庫一覧の取得
app.get('/api/inventory', async (req, res) => {
  try {
    const command = new ScanCommand({ TableName: INVENTORY_TABLE });
    const response = await docClient.send(command);
    res.json(response.Items || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. [AWS] 売上一覧の取得 (ローカルの顧客情報とJOINする)
app.get('/api/sales', async (req, res) => {
  try {
    const salesCommand = new ScanCommand({ TableName: SALES_TABLE });
    const salesResponse = await docClient.send(salesCommand);
    const sales = salesResponse.Items || [];

    const customers = getLocalCustomers();
    const customerMap = {};
    customers.forEach(c => {
      customerMap[c.customer_uuid] = c;
    });

    const joinedSales = sales.map(sale => {
      const customerInfo = customerMap[sale.customer_uuid] || {
        customer_name: "【ローカルDB未登録・開示不可】",
        email: "-",
        phone: "-"
      };
      return {
        ...sale,
        customer_name: customerInfo.customer_name,
        customer_email: customerInfo.email,
        customer_phone: customerInfo.phone
      };
    });

    res.json(joinedSales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. [ローカル] 顧客一覧の取得 (AWSには問い合わせない)
app.get('/api/customers', (req, res) => {
  res.json(getLocalCustomers());
});

// 4. [ローカル] 顧客の追加
app.post('/api/customers', (req, res) => {
  const { customer_name, email, phone } = req.body;
  const customers = getLocalCustomers();
  const newCustomer = {
    customer_uuid: require('crypto').randomUUID(),
    customer_name,
    email,
    phone
  };
  customers.push(newCustomer);
  saveLocalCustomers(customers);
  res.status(201).json(newCustomer);
});

// 5. [AWS] 売上の新規登録
app.post('/api/sales', async (req, res) => {
  const { product_id, customer_uuid, quantity } = req.body;
  const newSale = {
    sale_id: require('crypto').randomUUID(),
    product_id,
    customer_uuid,
    quantity: Number(quantity),
    sale_date: new Date().toISOString()
  };

  try {
    const command = new PutCommand({
      TableName: SALES_TABLE,
      Item: newSale
    });
    await docClient.send(command);
    res.status(201).json(newSale);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Mock EC App running on port ${PORT}`);
  console.log(`- AWS Target Table Prefix: ${envName}`);
  console.log(`- Local Customer DB: ${LOCAL_DB_PATH}`);
});
