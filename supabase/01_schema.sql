-- =====================================================================
-- INVENTORY MANAGEMENT SYSTEM (IMS) - DATABASE SCHEMA
-- Course : CCS112 Applications Development and Emerging Technologies
-- Target : Supabase (PostgreSQL 15+)
-- Order  : 01_schema.sql (Run FIRST in Supabase SQL Editor)
-- =====================================================================
--
-- TABLE OF CONTENTS:
--   0. EXTENSIONS & ENUM TYPES
--      - Extensions (uuid-ossp, pgcrypto)
--      - movement_type_enum
--      - alert_type_enum
--      - alert_status_enum
--      - priority_enum
--      - product_status_enum
--
--   1. AUTHENTICATION & ACCESS CONTROL (RBAC)
--      - public.roles
--      - public.permissions
--      - public.role_permissions
--      - public.users
--
--   2. PRODUCT CATALOG & MASTER DATA
--      - public.categories
--      - public.suppliers
--      - public.products
--
--   3. INVENTORY & STOCK MANAGEMENT
--      - public.inventory
--      - public.stock_movements
--
--   4. NOTIFICATIONS & SYSTEM AUDITING
--      - public.alerts
--      - public.activity_logs
--
-- =====================================================================


-- =====================================================================
-- 0. EXTENSIONS & ENUM TYPES
-- =====================================================================

-- PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Movement types for inventory transactions
DO $$ BEGIN
  CREATE TYPE movement_type_enum AS ENUM (
    'stock_in',
    'stock_out',
    'damaged',
    'missing',
    'returned',
    'adjustment'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Alert categories
DO $$ BEGIN
  CREATE TYPE alert_type_enum AS ENUM (
    'low_stock',
    'out_of_stock',
    'reorder',
    'missing_item',
    'damaged_item',
    'near_expiry'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Lifecycle status for alerts
DO $$ BEGIN
  CREATE TYPE alert_status_enum AS ENUM (
    'active',
    'acknowledged',
    'resolved'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Severity/Priority levels
DO $$ BEGIN
  CREATE TYPE priority_enum AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Product catalog status
DO $$ BEGIN
  CREATE TYPE product_status_enum AS ENUM (
    'active',
    'inactive',
    'discontinued'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- =====================================================================
-- 1. AUTHENTICATION & ACCESS CONTROL (RBAC)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1.1 ROLES
-- Standard system roles: super_admin, warehouse_admin, staff_admin, finance_admin
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  role_id     SERIAL PRIMARY KEY,
  role_code   TEXT NOT NULL UNIQUE,          -- super_admin | warehouse_admin | staff_admin | finance_admin
  role_name   TEXT NOT NULL,
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT TRUE, -- system roles cannot be deleted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.roles IS 'User roles defining high-level access tiers in the system.';

-- ---------------------------------------------------------------------
-- 1.2 PERMISSIONS
-- Granular permissions assigned per module (e.g. inventory.create)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  permission_id   SERIAL PRIMARY KEY,
  permission_code TEXT NOT NULL UNIQUE,      -- e.g. inventory.create
  module          TEXT NOT NULL,             -- inventory | staff | finance | system
  description     TEXT
);

COMMENT ON TABLE public.permissions IS 'Granular capabilities mapped to modules.';

-- ---------------------------------------------------------------------
-- 1.3 ROLE_PERMISSIONS
-- Cross-reference table mapping roles to individual permissions
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id       INT NOT NULL REFERENCES public.roles(role_id) ON DELETE CASCADE,
  permission_id INT NOT NULL REFERENCES public.permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

COMMENT ON TABLE public.role_permissions IS 'Many-to-many relationship linking roles to granted permissions.';

-- ---------------------------------------------------------------------
-- 1.4 USERS
-- Profile rows mirroring Supabase auth.users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  user_id        UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name      TEXT NOT NULL,
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL UNIQUE,
  role_id        INT NOT NULL REFERENCES public.roles(role_id),
  contact_number TEXT,
  position       TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role_id);

COMMENT ON TABLE public.users IS 'Public user profiles connected to auth.users.';


-- =====================================================================
-- 2. PRODUCT CATALOG & MASTER DATA
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2.1 CATEGORIES
-- Item classifications (e.g., Electronics, Perishables, Office Supplies)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  category_id   SERIAL PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.categories IS 'Product groupings and taxonomies.';

-- ---------------------------------------------------------------------
-- 2.2 SUPPLIERS
-- Vendor directory and contact records
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  supplier_id    SERIAL PRIMARY KEY,
  supplier_name  TEXT NOT NULL,
  contact_person TEXT,
  contact_number TEXT,
  email          TEXT,
  address        TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.suppliers IS 'Registered product suppliers and contact info.';

-- ---------------------------------------------------------------------
-- 2.3 PRODUCTS
-- Master product catalog with SKU, pricing, category, and supplier info
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
  product_id      SERIAL PRIMARY KEY,
  product_name    TEXT NOT NULL,
  sku             TEXT NOT NULL UNIQUE,
  category_id     INT REFERENCES public.categories(category_id) ON DELETE SET NULL,
  supplier_id     INT REFERENCES public.suppliers(supplier_id)  ON DELETE SET NULL,
  unit_price      NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_of_measure TEXT DEFAULT 'pc',
  expiration_date DATE,
  status          product_status_enum NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_supplier ON public.products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_products_sku      ON public.products(sku);

COMMENT ON TABLE public.products IS 'Master catalog of all inventory products.';


-- =====================================================================
-- 3. INVENTORY & STOCK MANAGEMENT
-- =====================================================================

-- ---------------------------------------------------------------------
-- 3.1 INVENTORY
-- Current on-hand stock and reorder thresholds (1:1 with products)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
  inventory_id  SERIAL PRIMARY KEY,
  product_id    INT NOT NULL UNIQUE REFERENCES public.products(product_id) ON DELETE CASCADE,
  current_stock INT NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  minimum_stock INT NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  reorder_point INT NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  location      TEXT DEFAULT 'Main Warehouse',
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    UUID REFERENCES public.users(user_id) ON DELETE SET NULL
);

COMMENT ON TABLE public.inventory IS 'Real-time stock quantities and threshold limits per product.';

-- ---------------------------------------------------------------------
-- 3.2 STOCK_MOVEMENTS
-- Immutable audit log for all stock movements and shrinkage tracking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  movement_id   SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  movement_type movement_type_enum NOT NULL,
  quantity      INT NOT NULL,
  reason        TEXT,
  reference_no  TEXT,
  date_recorded TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by   UUID REFERENCES public.users(user_id) ON DELETE SET NULL,

  -- Adjustments may be negative (stock correction); every other movement type must be positive
  CONSTRAINT chk_movement_qty CHECK (
    (movement_type = 'adjustment' AND quantity <> 0)
    OR (movement_type <> 'adjustment' AND quantity > 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_movements_date    ON public.stock_movements(date_recorded DESC);

COMMENT ON TABLE public.stock_movements IS 'Immutable ledger tracking stock movements, receipts, and shrinkage.';


-- =====================================================================
-- 4. NOTIFICATIONS & SYSTEM AUDITING
-- =====================================================================

-- ---------------------------------------------------------------------
-- 4.1 ALERTS
-- Automated alerts (out of stock, low stock, reorder, near expiry, damaged)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alerts (
  alert_id      SERIAL PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES public.products(product_id) ON DELETE CASCADE,
  alert_type    alert_type_enum NOT NULL,
  alert_message TEXT NOT NULL,
  alert_status  alert_status_enum NOT NULL DEFAULT 'active',
  priority      priority_enum NOT NULL DEFAULT 'medium',
  date_created  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES public.users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_product ON public.alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status  ON public.alerts(alert_status);

-- Only one ACTIVE alert of a given type per product
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_active ON public.alerts(product_id, alert_type)
  WHERE alert_status = 'active';

COMMENT ON TABLE public.alerts IS 'System notifications and warnings regarding stock and product status.';

-- ---------------------------------------------------------------------
-- 4.2 ACTIVITY_LOGS
-- Comprehensive activity logging for administrative auditing
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_logs (
  log_id      BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_user    ON public.activity_logs(user_id);

COMMENT ON TABLE public.activity_logs IS 'System audit trail tracking user and administrative actions.';
