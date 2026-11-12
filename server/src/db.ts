import mysql from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import { env } from './env';

export const pool = mysql.createPool({
  host: env.mysql.host,
  port: env.mysql.port,
  user: env.mysql.user,
  password: env.mysql.password,
  database: env.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,    // DATE/DATETIME 以字符串返回，避免时区漂移
  decimalNumbers: true, // DECIMAL 以 number 返回
});

export type Row = RowDataPacket & Record<string, any>;
