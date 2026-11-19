import { Controller, Get, Query, Req, UseGuards, Version } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { JwtAuthGuard } from '../identity/jwt-auth.guard';
import { WalletHistoryDto, walletHistorySchema, type WalletHistoryInput } from './dto/wallet-history.dto';
import { WalletService } from './wallet.service';

interface AuthedRequest {
  user: { id: string; sessionId: string };
}

@ApiTags('wallet')
@Controller({ path: 'wallet' })
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  balance(@Req() req: AuthedRequest) {
    return this.wallet.getBalance(req.user.id);
  }

  @Get('transactions')
  @Version('1')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiQuery({ type: WalletHistoryDto })
  history(
    @Query(new ZodValidationPipe<WalletHistoryInput>(walletHistorySchema)) query: WalletHistoryInput,
    @Req() req: AuthedRequest,
  ) {
    return this.wallet.history(req.user.id, query.limit);
  }
}
