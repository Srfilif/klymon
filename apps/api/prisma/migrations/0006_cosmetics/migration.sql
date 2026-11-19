-- CreateTable
CREATE TABLE "cosmetics" (
    "id" VARCHAR(64) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slot" VARCHAR(16) NOT NULL,
    "rarity" VARCHAR(16) NOT NULL,
    "price" INTEGER NOT NULL DEFAULT 0,
    "description" VARCHAR(280),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cosmetics" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "cosmeticId" VARCHAR(64) NOT NULL,
    "source" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_cosmetics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loadouts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "equipped" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loadouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_cosmetics_userId_idx" ON "user_cosmetics"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_cosmetics_userId_cosmeticId_key" ON "user_cosmetics"("userId", "cosmeticId");

-- CreateIndex
CREATE UNIQUE INDEX "loadouts_userId_key" ON "loadouts"("userId");

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_cosmetics" ADD CONSTRAINT "user_cosmetics_cosmeticId_fkey" FOREIGN KEY ("cosmeticId") REFERENCES "cosmetics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loadouts" ADD CONSTRAINT "loadouts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SeedCatalog
INSERT INTO "cosmetics" ("id", "name", "slot", "rarity", "price", "description") VALUES
  ('cape-founder-aurora', 'Aurora Cape', 'cape', 'legendary', 0, 'Founder cape. Granted, never sold.'),
  ('cape-ember', 'Ember Cape', 'cape', 'rare', 800, 'A cape that smoulders at the edges.'),
  ('hat-top-hat', 'Top Hat', 'hat', 'epic', 1200, 'For distinguished miners.'),
  ('trail-sparkle', 'Sparkle Trail', 'trail', 'common', 300, 'A faint glitter wherever you walk.'),
  ('pet-wisp', 'Wisp Pet', 'pet', 'epic', 1500, 'A small light that follows you around.'),
  ('emote-wave', 'Wave Emote', 'emote', 'common', 200, 'Say hello from across the server.');
