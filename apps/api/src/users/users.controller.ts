import { Body, Controller, Get, NotFoundException, Param, Patch, Req, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { UsersService } from '../identity/users.service';
import { UpdateProfileDto, updateProfileSchema, type UpdateProfileInput } from './dto/update-profile.dto';

interface AuthedRequest {
  user: { id: string; sessionId: string };
}

@ApiTags('users')
@Controller({ path: 'users' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async me(@Req() req: AuthedRequest) {
    const profile = await this.users.findPublicById(req.user.id);
    if (!profile) throw new NotFoundException('User not found.');
    return profile;
  }

  @Patch('me')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiBody({ type: UpdateProfileDto })
  patchMe(
    @Body(new ZodValidationPipe<UpdateProfileInput>(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: AuthedRequest,
  ) {
    return this.users.updateProfile(req.user.id, body);
  }

  @Get(':username')
  @Version('1')
  async publicProfile(@Param('username') username: string) {
    const profile = await this.users.getPublicProfile(username);
    if (!profile) throw new NotFoundException('User not found.');
    return profile;
  }
}
