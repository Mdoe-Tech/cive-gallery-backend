import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 5050);

  await app.listen(port);
  logger.log(`Application running on port ${port}`);
  logger.log(`Environment: ${configService.get<string>('NODE_ENV', 'development')}`);
  logger.log(`Redis cache enabled at: ${configService.get<string>('REDIS_URL', 'redis://localhost:6379')}`);
}
bootstrap();
