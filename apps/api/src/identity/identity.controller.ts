import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MinecraftService } from './minecraft.service';
import { UsersService } from './users.service';
import { LoginDto, loginSchema, type LoginInput } from './dto/login.dto';
import {
  LinkMinecraftDto,
  linkMinecraftSchema,
  SyncMinecraftDto,
  syncMinecraftSchema,
  type LinkMinecraftInput,
  type SyncMinecraftInput,
} from './dto/minecraft.dto';
import {
  ChangePasswordDto,
  changePasswordSchema,
  type ChangePasswordInput,
  RequestPasswordResetDto,
  requestPasswordResetSchema,
  RequestVerificationDto,
  requestVerificationSchema,
  ResetPasswordDto,
  resetPasswordSchema,
  type ResetPasswordInput,
  VerifyEmailDto,
  verifyEmailSchema,
} from './dto/recovery.dto';
import { RefreshDto, refreshSchema } from './dto/refresh.dto';
import { RegisterDto, registerSchema, type RegisterInput } from './dto/register.dto';
import { ExchangeHandoffDto, exchangeHandoffSchema, type ExchangeHandoffInput } from './dto/handoff.dto';

interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}

interface AuthedRequest extends HttpRequest {
  user: { id: string; sessionId: string };
}

function requestContext(req: HttpRequest): { userAgent?: string; ip?: string } {
  const userAgent = req.headers['user-agent'];
  return {
    userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    ip: req.ip,
  };
}

@ApiTags('auth')
@Controller({ path: 'auth' })
export class IdentityController {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly minecraft: MinecraftService,
  ) {}

  @Post('register')
  @Version('1')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: RegisterDto })
  register(@Body(new ZodValidationPipe<RegisterInput>(registerSchema)) body: RegisterInput, @Req() req: HttpRequest) {
    return this.auth.register(body, requestContext(req));
  }

  @Post('login')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: LoginDto })
  login(@Body(new ZodValidationPipe<LoginInput>(loginSchema)) body: LoginInput, @Req() req: HttpRequest) {
    return this.auth.login(body, requestContext(req));
  }

  @Post('refresh')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiBody({ type: RefreshDto })
  refresh(@Body(new ZodValidationPipe<{ refreshToken: string }>(refreshSchema)) body: { refreshToken: string }, @Req() req: HttpRequest) {
    return this.auth.refresh(body.refreshToken, requestContext(req));
  }

  @Post('logout')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async logout(@Req() req: AuthedRequest): Promise<void> {
    await this.auth.logout(req.user.id, req.user.sessionId);
  }

  @Get('me')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@Req() req: AuthedRequest) {
    return this.users.findPublicById(req.user.id);
  }

  @Get('sessions')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  sessions(@Req() req: AuthedRequest) {
    return this.auth.listSessions(req.user.id);
  }

  @Delete('sessions/:id')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async revokeSession(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.auth.revokeSession(req.user.id, id);
  }

  @Post('handoff')
  @Version('1')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  handoff(@Req() req: AuthedRequest) {
    return this.auth.createHandoff(req.user.id, req.user.sessionId);
  }

  @Post('handoff/exchange')
  @Version('1')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: ExchangeHandoffDto })
  exchange(
    @Body(new ZodValidationPipe<ExchangeHandoffInput>(exchangeHandoffSchema)) body: ExchangeHandoffInput,
    @Req() req: HttpRequest,
  ) {
    return this.auth.exchangeHandoff(body.code, requestContext(req));
  }

  @Post('email/request-verification')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBody({ type: RequestVerificationDto })
  requestVerification(
    @Body(new ZodValidationPipe<Record<string, never>>(requestVerificationSchema)) _body: Record<string, never>,
    @Req() req: AuthedRequest,
  ) {
    void _body;
    return this.auth.requestEmailVerification(req.user.id);
  }

  @Post('email/verify')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: VerifyEmailDto })
  verifyEmail(@Body(new ZodValidationPipe<{ token: string }>(verifyEmailSchema)) body: { token: string }) {
    return this.auth.verifyEmail(body.token);
  }

  @Post('password/request-reset')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiBody({ type: RequestPasswordResetDto })
  requestPasswordReset(@Body(new ZodValidationPipe<{ email: string }>(requestPasswordResetSchema)) body: { email: string }) {
    return this.auth.requestPasswordReset(body.email);
  }

  @Post('password/reset')
  @Version('1')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: ResetPasswordDto })
  resetPassword(@Body(new ZodValidationPipe<ResetPasswordInput>(resetPasswordSchema)) body: ResetPasswordInput) {
    return this.auth.resetPassword(body.token, body.newPassword).then(() => ({ reset: true }));
  }

  @Post('password/change')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: ChangePasswordDto })
  async changePassword(
    @Body(new ZodValidationPipe<ChangePasswordInput>(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: AuthedRequest,
  ): Promise<void> {
    await this.auth.changePassword(req.user.id, req.user.sessionId, body.currentPassword, body.newPassword);
  }

  @Get('devices')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  devices(@Req() req: AuthedRequest) {
    return this.auth.listDevices(req.user.id);
  }

  @Delete('devices/:id')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async revokeDevice(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.auth.revokeDevice(req.user.id, id);
  }

  @Get('minecraft')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listMinecraft(@Req() req: AuthedRequest) {
    return this.auth.listMinecraftAccounts(req.user.id);
  }

  @Post('minecraft/link')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: LinkMinecraftDto })
  linkMinecraft(@Body(new ZodValidationPipe<LinkMinecraftInput>(linkMinecraftSchema)) body: LinkMinecraftInput, @Req() req: AuthedRequest) {
    return this.auth.linkMinecraftAccount(req.user.id, body);
  }

  @Delete('minecraft/:id')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async unlinkMinecraft(@Req() req: AuthedRequest, @Param('id') id: string): Promise<void> {
    await this.auth.unlinkMinecraftAccount(req.user.id, id);
  }

  @Post('minecraft/:id/sync')
  @Version('1')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: SyncMinecraftDto })
  async syncMinecraft(
    @Body(new ZodValidationPipe<SyncMinecraftInput>(syncMinecraftSchema)) body: SyncMinecraftInput,
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    await this.minecraft.syncAccount(req.user.id, id, body.minecraftAccessToken);
  }
}
