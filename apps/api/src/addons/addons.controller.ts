import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { AddonsService } from './addons.service';
import {
  BrowseAddonsDto,
  browseAddonsSchema,
  CreateAddonDto,
  createAddonSchema,
  CreateAddonVersionDto,
  createAddonVersionSchema,
  RegisterKeyDto,
  registerKeySchema,
  UpdateAddonDto,
  updateAddonSchema,
  type BrowseAddonsInput,
  type CreateAddonInput,
  type CreateAddonVersionInput,
  type RegisterKeyInput,
  type UpdateAddonInput,
} from './dto/addons.dto';

interface AuthedRequest {
  user: { id: string; sessionId: string };
}

@ApiTags('addons')
@Controller({ path: 'addons' })
export class AddonsController {
  constructor(private readonly addons: AddonsService) {}

  @Get()
  @Version('1')
  @ApiQuery({ type: BrowseAddonsDto })
  browse(@Query(new ZodValidationPipe<BrowseAddonsInput>(browseAddonsSchema)) query: BrowseAddonsInput) {
    return this.addons.browse(query);
  }

  @Get('mine')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  mine(@Req() req: AuthedRequest) {
    return this.addons.myAddons(req.user.id);
  }

  // NOTE: literal sub-paths stay above ':id' so they are not swallowed by it.
  @Get('keys')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  keys(@Req() req: AuthedRequest) {
    return this.addons.myKeys(req.user.id);
  }

  @Post('keys')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: RegisterKeyDto })
  registerKey(@Body(new ZodValidationPipe<RegisterKeyInput>(registerKeySchema)) body: RegisterKeyInput, @Req() req: AuthedRequest) {
    return this.addons.registerKey(req.user.id, body);
  }

  @Delete('keys/:fingerprint')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async revokeKey(@Param('fingerprint') fingerprint: string, @Req() req: AuthedRequest): Promise<void> {
    await this.addons.revokeKey(req.user.id, fingerprint);
  }

  @Get(':id')
  @Version('1')
  detail(@Param('id') id: string) {
    return this.addons.getPublished(id);
  }

  @Get(':id/versions')
  @Version('1')
  versions(@Param('id') id: string) {
    return this.addons.versions(id);
  }

  @Post()
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: CreateAddonDto })
  create(@Body(new ZodValidationPipe<CreateAddonInput>(createAddonSchema)) body: CreateAddonInput, @Req() req: AuthedRequest) {
    return this.addons.create(req.user.id, body);
  }

  @Patch(':id')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: UpdateAddonDto })
  update(
    @Body(new ZodValidationPipe<UpdateAddonInput>(updateAddonSchema)) body: UpdateAddonInput,
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ) {
    return this.addons.update(req.user.id, id, body);
  }

  @Post(':id/versions')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: CreateAddonVersionDto })
  publishVersion(
    @Body(new ZodValidationPipe<CreateAddonVersionInput>(createAddonVersionSchema)) body: CreateAddonVersionInput,
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ) {
    return this.addons.publishVersion(req.user.id, id, body);
  }
}
