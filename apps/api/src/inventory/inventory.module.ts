import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CosmeticsService } from './cosmetics.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [IdentityModule],
  controllers: [InventoryController],
  providers: [CosmeticsService, InventoryService],
  exports: [CosmeticsService, InventoryService],
})
export class InventoryModule {}
