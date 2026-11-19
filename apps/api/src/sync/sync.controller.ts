import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { SyncService } from './sync.service';
import {
  CreateProfileDto,
  createProfileSchema,
  ListVersionsDto,
  listVersionsSchema,
  PushDocumentDto,
  pushDocumentSchema,
  RenameProfileDto,
  renameProfileSchema,
  RestoreVersionDto,
  restoreVersionSchema,
  type CreateProfileInput,
  type ListVersionsInput,
  type PushDocumentInput,
  type RenameProfileInput,
  type RestoreVersionInput,
} from './dto/sync.dto';

interface AuthedRequest {
  user: { id: string; sessionId: string };
  headers: Record<string, string | string[] | undefined>;
}

function deviceLabel(req: AuthedRequest): string | undefined {
  const agent = req.headers['user-agent'];
  return typeof agent === 'string' ? agent : undefined;
}

@ApiTags('sync')
@Controller({ path: 'sync/profiles' })
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  @Version('1')
  profiles(@Req() req: AuthedRequest) {
    return this.sync.listProfiles(req.user.id);
  }

  @Post()
  @Version('1')
  @ApiBody({ type: CreateProfileDto })
  create(@Body(new ZodValidationPipe<CreateProfileInput>(createProfileSchema)) body: CreateProfileInput, @Req() req: AuthedRequest) {
    return this.sync.createProfile(req.user.id, body.name);
  }

  @Patch(':id')
  @Version('1')
  @ApiBody({ type: RenameProfileDto })
  rename(
    @Param('id') id: string,
    @Body(new ZodValidationPipe<RenameProfileInput>(renameProfileSchema)) body: RenameProfileInput,
    @Req() req: AuthedRequest,
  ) {
    return this.sync.renameProfile(req.user.id, id, body.name);
  }

  @Delete(':id')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthedRequest): Promise<void> {
    await this.sync.deleteProfile(req.user.id, id);
  }

  @Get(':id/documents')
  @Version('1')
  documents(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.sync.listDocuments(req.user.id, id);
  }

  @Get(':id/documents/:namespace')
  @Version('1')
  document(@Param('id') id: string, @Param('namespace') namespace: string, @Req() req: AuthedRequest) {
    return this.sync.getDocument(req.user.id, id, namespace);
  }

  @Put(':id/documents/:namespace')
  @Version('1')
  @ApiBody({ type: PushDocumentDto })
  push(
    @Param('id') id: string,
    @Param('namespace') namespace: string,
    @Body(new ZodValidationPipe<PushDocumentInput>(pushDocumentSchema)) body: PushDocumentInput,
    @Req() req: AuthedRequest,
  ) {
    return this.sync.push(req.user.id, id, namespace, body.baseVersion, body.content, body.force, deviceLabel(req));
  }

  @Get(':id/documents/:namespace/versions')
  @Version('1')
  @ApiQuery({ type: ListVersionsDto })
  versions(
    @Param('id') id: string,
    @Param('namespace') namespace: string,
    @Query(new ZodValidationPipe<ListVersionsInput>(listVersionsSchema)) query: ListVersionsInput,
    @Req() req: AuthedRequest,
  ) {
    return this.sync.listVersions(req.user.id, id, namespace, query.limit);
  }

  @Get(':id/documents/:namespace/versions/:version')
  @Version('1')
  version(@Param('id') id: string, @Param('namespace') namespace: string, @Param('version') version: string, @Req() req: AuthedRequest) {
    return this.sync.getVersion(req.user.id, id, namespace, Number(version));
  }

  @Post(':id/documents/:namespace/restore')
  @Version('1')
  @ApiBody({ type: RestoreVersionDto })
  restore(
    @Param('id') id: string,
    @Param('namespace') namespace: string,
    @Body(new ZodValidationPipe<RestoreVersionInput>(restoreVersionSchema)) body: RestoreVersionInput,
    @Req() req: AuthedRequest,
  ) {
    return this.sync.restore(req.user.id, id, namespace, body.baseVersion, body.version);
  }
}
