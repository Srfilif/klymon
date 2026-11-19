import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';
import { IdentityController } from './identity.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { MinecraftService } from './minecraft.service';
import { UsersService } from './users.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: Number(config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS')) },
      }),
    }),
  ],
  controllers: [IdentityController, DeviceController],
  providers: [AuthService, DeviceService, UsersService, JwtAuthGuard, MinecraftService],
  exports: [UsersService, JwtAuthGuard, JwtModule],
})
export class IdentityModule {}
