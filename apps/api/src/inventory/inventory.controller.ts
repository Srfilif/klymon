import { Body, Controller, Get, Post, Req, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import {
  EquipDto,
  equipSchema,
  PurchaseDto,
  purchaseSchema,
  type EquipInput,
  type PurchaseInput,
} from './dto/cosmetics.dto';
import { InventoryService } from './inventory.service';

interface AuthedRequest {
  user: { id: string; sessionId: string };
}

@ApiTags('inventory')
@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('cosmetics')
  @Version('1')
  catalog() {
    return this.inventory.catalog();
  }

  @Get('inventory')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  owned(@Req() req: AuthedRequest) {
    return this.inventory.inventory(req.user.id);
  }

  @Post('inventory/purchase')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: PurchaseDto })
  purchase(@Body(new ZodValidationPipe<PurchaseInput>(purchaseSchema)) body: PurchaseInput, @Req() req: AuthedRequest) {
    return this.inventory.purchase(req.user.id, body.cosmeticId);
  }

  @Post('inventory/equip')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: EquipDto })
  equip(@Body(new ZodValidationPipe<EquipInput>(equipSchema)) body: EquipInput, @Req() req: AuthedRequest) {
    return this.inventory.equip(req.user.id, body.slot, body.cosmeticId);
  }
}
