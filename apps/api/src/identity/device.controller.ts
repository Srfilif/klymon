import { Body, Controller, Get, HttpStatus, Post, Query, Req, Res, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { DeviceService } from './device.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  DeviceTokenDto,
  deviceTokenSchema,
  PreviewDeviceDto,
  previewDeviceSchema,
  StartDeviceFlowDto,
  startDeviceFlowSchema,
  UserCodeDto,
  userCodeSchema,
  type DeviceTokenInput,
  type PreviewDeviceInput,
  type StartDeviceFlowInput,
  type UserCodeInput,
} from './dto/device.dto';

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
@Controller({ path: 'auth/device' })
export class DeviceController {
  constructor(private readonly device: DeviceService) {}

  @Post('code')
  @Version('1')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiBody({ type: StartDeviceFlowDto })
  start(@Body(new ZodValidationPipe<StartDeviceFlowInput>(startDeviceFlowSchema)) body: StartDeviceFlowInput) {
    return this.device.startDeviceFlow(body.clientName);
  }

  @Post('token')
  @Version('1')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiBody({ type: DeviceTokenDto })
  async poll(
    @Body(new ZodValidationPipe<DeviceTokenInput>(deviceTokenSchema)) body: DeviceTokenInput,
    @Req() req: HttpRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.device.pollDeviceToken(body.deviceCode, requestContext(req));
    if ('status' in result) res.status(HttpStatus.ACCEPTED);
    return result;
  }

  @Get('preview')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiQuery({ type: PreviewDeviceDto })
  preview(@Query(new ZodValidationPipe<PreviewDeviceInput>(previewDeviceSchema)) query: PreviewDeviceInput) {
    return this.device.previewDeviceCode(query.code);
  }

  @Post('approve')
  @Version('1')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: UserCodeDto })
  approve(@Body(new ZodValidationPipe<UserCodeInput>(userCodeSchema)) body: UserCodeInput, @Req() req: AuthedRequest) {
    return this.device.approveDeviceCode(req.user.id, body.userCode);
  }

  @Post('deny')
  @Version('1')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: UserCodeDto })
  deny(@Body(new ZodValidationPipe<UserCodeInput>(userCodeSchema)) body: UserCodeInput, @Req() req: AuthedRequest) {
    return this.device.denyDeviceCode(body.userCode);
  }
}
