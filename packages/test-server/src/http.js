import { startHttpServer } from './transport/http.js';

startHttpServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
