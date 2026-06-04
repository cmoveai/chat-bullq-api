import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';

/**
 * Disponibiliza a EncryptionService em toda a aplicação (cifra de segredos
 * at-rest por tenant: tokens WhatsApp/Meta, Pixel, Dataset).
 */
@Global()
@Module({
  providers: [EncryptionService],
  exports: [EncryptionService],
})
export class EncryptionModule {}
