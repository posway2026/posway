import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import customerRoutes from './routes/customers.js';
import saleRoutes from './routes/sales.js';
import reportRoutes from './routes/reports.js';
import cashMovementRoutes from './routes/cashMovements.js';
import supplierDebtRoutes from './routes/supplierDebts.js';
import cashCloseRoutes from './routes/cashCloses.js';
import stockMovementRoutes from './routes/stockMovements.js';
import aiExtractRoutes from './routes/aiExtract.js';

dotenv.config();

const app = express();
app.use(cors());
// (2026-09-20) Standart limit (100kb) hisob-faktura rasmlari (base64)
// uchun juda kichik — AI orqali rasmdan mahsulot o'qish funksiyasi bir
// necha rasmni birga yuborishi mumkin, shuning uchun limitni oshiramiz.
app.use(express.json({ limit: '20mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/cash-movements', cashMovementRoutes);
app.use('/api/supplier-debts', supplierDebtRoutes);
app.use('/api/cash-closes', cashCloseRoutes);
app.use('/api/stock-movements', stockMovementRoutes);
app.use('/api/ai', aiExtractRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Posway server ${PORT}-portda ishga tushdi`);
});
