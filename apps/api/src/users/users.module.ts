import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { UsersController } from './users.controller';

@Module({
  imports: [IdentityModule],
  controllers: [UsersController],
})
export class UsersModule {}
