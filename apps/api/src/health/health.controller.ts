import { Controller, Get, ServiceUnavailableException, Version } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller({ path: 'health' })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @Version('1')
  live(): { status: string; time: string } {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Get('ready')
  @Version('1')
  async ready(): Promise<{ status: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('Database unreachable.');
    }
  }
}
