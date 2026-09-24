import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './routes';

const app: Express = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api', routes);

export default app;
