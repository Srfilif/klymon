import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import {
  CreateCosmeticDto,
  createCosmeticSchema,
  GrantCosmeticDto,
  grantCosmeticSchema,
  UpdateCosmeticDto,
  updateCosmeticSchema,
  type CreateCosmeticInput,
  type GrantCosmeticInput,
  type UpdateCosmeticInput,
} from '../inventory/dto/cosmetics.dto';
import {
  BrowseAddonsDto,
  browseAddonsSchema,
  SetVisibilityDto,
  setVisibilitySchema,
  type BrowseAddonsInput,
  type SetVisibilityInput,
} from '../addons/dto/addons.dto';
import { CosmeticsService } from '../inventory/cosmetics.service';
import { AddonsService } from '../addons/addons.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import {
  AdminAdjustDto,
  AdminUsersQueryDto,
  adminAdjustSchema,
  adminUsersQuerySchema,
  type AdminAdjustInput,
  type AdminUsersQueryInput,
} from './dto/admin.dto';

@ApiTags('admin')
@Controller({ path: 'admin' })
@UseGuards(AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly cosmetics: CosmeticsService,
    private readonly addons: AddonsService,
  ) {}

  @Get('users')
  @Version('1')
  @ApiQuery({ type: AdminUsersQueryDto })
  users(@Query(new ZodValidationPipe<AdminUsersQueryInput>(adminUsersQuerySchema)) query: AdminUsersQueryInput) {
    return this.admin.listUsers(query);
  }

  @Get('stats')
  @Version('1')
  stats() {
    return this.admin.getStats();
  }

  @Post('wallets/adjust')
  @Version('1')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiBody({ type: AdminAdjustDto })
  adjust(@Body(new ZodValidationPipe<AdminAdjustInput>(adminAdjustSchema)) body: AdminAdjustInput) {
    return this.admin.adjustWallet(body.userId, body.amount, body.reason);
  }

  @Get('cosmetics')
  @Version('1')
  listCosmetics() {
    return this.cosmetics.list();
  }

  @Post('cosmetics')
  @Version('1')
  @ApiBody({ type: CreateCosmeticDto })
  createCosmetic(@Body(new ZodValidationPipe<CreateCosmeticInput>(createCosmeticSchema)) body: CreateCosmeticInput) {
    return this.cosmetics.create(body);
  }

  @Patch('cosmetics/:id')
  @Version('1')
  @ApiBody({ type: UpdateCosmeticDto })
  updateCosmetic(
    @Body(new ZodValidationPipe<UpdateCosmeticInput>(updateCosmeticSchema)) body: UpdateCosmeticInput,
    @Param('id') id: string,
  ) {
    return this.cosmetics.update(id, body);
  }

  @Delete('cosmetics/:id')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCosmetic(@Param('id') id: string): Promise<void> {
    await this.cosmetics.remove(id);
  }

  @Post('cosmetics/grant')
  @Version('1')
  @ApiBody({ type: GrantCosmeticDto })
  grant(@Body(new ZodValidationPipe<GrantCosmeticInput>(grantCosmeticSchema)) body: GrantCosmeticInput) {
    return this.cosmetics.grant(body.userId, body.cosmeticId);
  }

  @Get('addons')
  @Version('1')
  @ApiQuery({ type: BrowseAddonsDto })
  adminAddons(@Query(new ZodValidationPipe<BrowseAddonsInput>(browseAddonsSchema)) query: BrowseAddonsInput) {
    return this.addons.adminList(query);
  }

  @Patch('addons/:id/visibility')
  @Version('1')
  @ApiBody({ type: SetVisibilityDto })
  setVisibility(
    @Body(new ZodValidationPipe<SetVisibilityInput>(setVisibilitySchema)) body: SetVisibilityInput,
    @Param('id') id: string,
  ) {
    return this.addons.setVisibility(id, body.visibility);
  }

  @Get('addons/:id')
  @Version('1')
  adminAddonDetail(@Param('id') id: string) {
    return this.addons.adminDetail(id);
  }
}
