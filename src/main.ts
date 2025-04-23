// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express'; // <<< Import this
import { join } from 'path'; // <<< Import join

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // <<< Use NestExpressApplication platform >>>
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // --- Enable CORS ---
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  logger.log(`Enabling CORS for origin: ${frontendUrl}`);
  app.enableCors({
    origin: frontendUrl,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });
  // --- End CORS ---

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // --- Add Static Assets Configuration ---
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });
  logger.log(`Serving static assets from '${join(__dirname, '..', 'uploads')}' at '/uploads/'`);

  const port = configService.get<number>('PORT', 5050);
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
  logger.log(`Environment: ${configService.get<string>('NODE_ENV', 'development')}`);
  logger.log(`Redis cache enabled at: ${configService.get<string>('REDIS_URL', 'redis://localhost:6379')}`); // Optional Redis log
}
bootstrap();
