# MySQL 5.7 → 8.0 升级方案（服务器 45.32.56.92）

> 目标：把 Vultr 服务器 `45.32.56.92` 的 MySQL 从 **5.7.44** 升级到 **8.0.x LTS**，
> 为 `isee_videos_db` 与后续财务系统提供窗口函数 / CTE / 现代化优化器能力。
> 本文只评估与规划，**不执行任何变更**。

---

## 1. 现状盘点

### 1.1 已探明（只读查询所得）

| 项 | 值 | 说明 |
|---|---|---|
| MySQL 版本 | `5.7.44-log` | 5.7 最后一个版本 |
| 主机名 | `vultr` | Vultr 云主机 |
| 数据规模 | `isee_videos_db` **20.2 MB / 30 表** | 极小，迁移成本低 |
| 存储引擎 | 全部 InnoDB | 无 MyISAM 兼容顾虑 |
| `innodb_buffer_pool_size` | 128 MB（默认值） | 提示为**小内存实例**，需关注 8.0 内存占用 |
| `max_connections` | 500 | — |
| `sql_mode` | `IGNORE_SPACE,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION` | 非默认值，升级后建议显式沿用 |
| `lower_case_table_names` | `0` | **升级前后必须保持一致**，不可变更 |
| 字符集 | `utf8mb4` | 良好 |

### 1.2 待你在服务器上确认（本机无 SSH 权限）

请在服务器执行以下只读命令并回填：

```bash
cat /etc/os-release | head -3        # 发行版（决定用 apt 还是 yum）
free -m                              # 内存总量（<1GB 需调参/升配）
df -h /                              # 磁盘余量（升级需临时空间）
mysqld --version                     # 安装版本与路径
dpkg -l | grep -i mysql   # Debian/Ubuntu 安装方式
# 或
rpm -qa | grep -i mysql   # RHEL/CentOS 安装方式
systemctl is-active mysqld            # 服务管理方式
```

> 未确认前，下文步骤给出 **apt / yum 两种分支**，按实际发行版取其一。

---

## 2. 影响评估

### 2.1 成本

| 维度 | 评估 |
|---|---|
| 数据迁移 | 20MB，**秒级**，可忽略 |
| 停机窗口 | 约 **30–60 分钟**（备份 + 安装 + 导入 + 验证） |
| 费用 | Vultr 快照约 **$0.05/GB/月**；若需临时升配内存，费用可回退 |
| 人力 | 1 人按本文清单执行 |

**结论：成本不大。**

### 2.2 风险矩阵

| # | 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|---|
| 1 | 小内存 VPS 上 8.0 **OOM** | 中 | 高 | 关闭/精简 `performance_schema`、调小缓冲池；或临时升配 |
| 2 | **保留字冲突**（RANK/ROW_NUMBER 等） | 低 | 高 | 升级前跑官方升级检查器扫描 |
| 3 | 认证插件变更（`caching_sha2_password`） | 低 | 中 | mysql2 原生支持两种；老用户保留 native |
| 4 | `sql_mode` 默认值变化致 SQL 报错 | 低 | 中 | 升级后显式沿用现有 `sql_mode` |
| 5 | 查询缓存被移除（5.7 有，8.0 无） | 低 | 低 | Node/mysql2 不依赖 |
| 6 | `utf8` → `utf8mb3` 别名调整 | 低 | 低 | 现有数据已是 `utf8mb4`，无影响 |
| 7 | `lower_case_table_names` 不一致 | 低 | 高 | 保持 `0`，不修改 |
| 8 | 升级中断导致半升级状态 | 低 | 高 | 快照 + 逻辑备份双保险，失败即回滚 |

---

## 3. 回滚机制（关键）

> ⚠️ **MySQL 不支持 8.0 → 5.7 就地降级**。因此"卸掉 8.0 再装回 5.7 以保留数据"是不可行的。
> 回滚必须依靠**快照**或**备份重建**。

### 3.1 方案 A：Vultr 整机快照（首选）

- 升级前对实例打快照 `pre-mysql80-YYYYMMDD`。
- 出问题 → 控制台 **Restore Snapshot**，整机（系统 + 数据）一键回到升级前。
- 优点：最可靠、最省事；缺点：会丢弃快照之后的所有写入（对本场景可接受）。

### 3.2 方案 B：逻辑备份重建

- 升级前 `mysqldump --all-databases` 全量导出。
- 出问题 → 在一台干净的 **5.7** 实例上导入该 dump 重建。
- 优点：可跨机；缺点：恢复耗时更长，且需要一台 5.7 环境。

### 3.3 建议

**两者同时做**：先打快照（回滚主力），再导出 dump（跨机兜底）。二者完成并验证前，**不进入升级步骤**。

---

## 4. 升级路径选择

| 路径 | 说明 | 评价 |
|---|---|---|
| **就地包升级** | 用 apt/yum 把 5.7 包替换为 8.0，`mysqld` 原地升级数据字典 | 快，但一旦失败只能靠快照回滚 |
| **逻辑导出重建（推荐）** | dump 5.7 → 装 8.0 → 导入 | 更干净，可先在 staging 演练，风险最低 |

**推荐逻辑导出重建**：数据仅 20MB，导出/导入几乎无成本，却能把"升级失败"变成"重新导入"。

---

## 5. 分步执行清单

### 阶段 0 · 准备（不改动生产）

1. **确认 1.2 的信息**（OS / 内存 / 磁盘 / 安装方式）。
2. **打 Vultr 快照** `pre-mysql80-YYYYMMDD`（控制台或 API）。
3. **创建只读备份账号 + 备份**（用 `--defaults-extra-file` 传密码，避免命令行泄漏）：

   ```bash
   # ~/.my-backup.cnf
   [client]
   user=root
   password=<ROOT_PASSWORD>
   host=localhost

   chmod 600 ~/.my-backup.cnf
   mysqldump --defaults-extra-file=~/.my-backup.cnf \
     --all-databases --single-transaction --routines --triggers --events \
     --set-gtid-purged=OFF > /root/backup-5.7-YYYYMMDD.sql
   md5sum /root/backup-5.7-YYYYMMDD.sql
   ```

4. **验证备份可恢复**：在本地或临时实例导入一次，确认无报错。
5. **跑官方升级检查器**（MySQL Shell）：

   ```bash
   mysqlsh -- util check-for-server-upgrade root@localhost \
     --target-version=8.0.40 --output-format=JSON
   ```

   重点看：保留字冲突、弃用语法、`utf8mb3` 告警。

### 阶段 1 · 安装 8.0

**Debian/Ubuntu（apt）**

```bash
apt-get update
apt-get install -y mysql-apt-config        # 选择 8.0
apt-get update
# 卸载 5.7 与安装 8.0（保留数据目录 /var/lib/mysql）
apt-get remove --purge -y mysql-server-5.7 mysql-client-5.7
apt-get install -y mysql-server
```

**RHEL/CentOS（yum）**

```bash
# 先移除 5.7 仓库，添加 8.0 仓库（按官方文档）
yum remove -y mysql-community-server mysql-community-client
yum install -y mysql-community-server
```

### 阶段 2 · 初始化与导入

**就地升级**：启动 `mysqld`，8.0 会自动升级数据字典，观察日志：

```bash
systemctl start mysqld
tail -f /var/log/mysql/error.log
```

**逻辑重建**（推荐）：初始化干净数据目录后导入：

```bash
mysql --defaults-extra-file=~/.my-backup.cnf -e "CREATE DATABASE isee_videos_db CHARACTER SET utf8mb4;"
mysql --defaults-extra-file=~/.my-backup.cnf isee_videos_db < /root/backup-5.7-YYYYMMDD.sql
```

### 阶段 3 · 配置对齐

在 `/etc/mysql/my.cnf`（或 `/etc/my.cnf`）显式固化关键项，避免默认值漂移：

```ini
[mysqld]
lower_case_table_names = 0
sql_mode = "IGNORE_SPACE,STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION"
character-set-server = utf8mb4
collation-server     = utf8mb4_unicode_ci
# 小内存机型建议（按实际内存调整）
innodb_buffer_pool_size = 256M
performance_schema      = OFF
```

> 若内存 ≤1GB 且启动异常，优先关闭 `performance_schema`、调小缓冲池；仍不足再临时升配。

### 阶段 4 · 应用侧

- 确认 `moive-database-op` 的 `mysql2` 连接不受影响（支持 `caching_sha2_password` 与 `mysql_native_password`）。
- 若用户仍为 native 插件，可保持不变；如需迁移：
  ```sql
  ALTER USER 'isee_videos_db'@'%' IDENTIFIED WITH caching_sha2_password BY '<PASSWORD>';
  ```

---

## 6. 升级后验证清单

- [ ] `SELECT VERSION();` 输出 8.0.x
- [ ] `isee_videos_db` 30 张表齐全，`information_schema` 行数合理
- [ ] 关键查询跑通：`movies` / `people` / `movie_credits` 联表
- [ ] 窗口函数可用：`SELECT ROW_NUMBER() OVER (ORDER BY id) FROM movies LIMIT 1;`
- [ ] CTE 可用：`WITH t AS (SELECT 1) SELECT * FROM t;`
- [ ] `lower_case_table_names` 仍为 `0`
- [ ] `sql_mode` 与升级前一致
- [ ] `moive-database-op` 后端可正常读写
- [ ] 错误日志无 `[ERROR]` / 崩溃
- [ ] 观察 24h 内存与连接数稳定

---

## 7. 与财务系统项目的衔接

| 阶段 | 动作 |
|---|---|
| 现在 | 财务系统用**本地 MySQL 9.6 独立库 `finance_analytics`** 开发 MVP，**不被服务器升级阻塞** |
| 92 升级完成后 | 视需要把财务库迁到远程（`CREATE DATABASE finance_analytics` + 导入），或用独立账号隔离 |
| 长期 | 生产财务库与 `isee_videos_db` 用**独立 database、独立账号、最小权限**隔离 |

---

## 8. 回滚执行卡（出问题时照做）

1. 停止 `mysqld`，避免继续写入。
2. **首选**：Vultr 控制台 → 该实例 → Snapshots → `pre-mysql80-*` → **Restore**。
3. 备选：新开一台 5.7 实例 → 导入 `backup-5.7-YYYYMMDD.sql` → 切换应用连接串。
4. 记录故障现象与日志，复现后再评估二次升级。
