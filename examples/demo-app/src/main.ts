import { createDemoApp } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = await createDemoApp();
await app.ingest();
app.server.listen(PORT, () => {
    console.log(`chronicle demo app listening on http://localhost:${PORT}`);
    console.log(`storage: ${process.env.MONGO_URL ? 'mongodb' : 'in-memory'}`);
    console.log(`llm: ${process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'scripted'}`);
    console.log('try: curl -s -X POST localhost:3000/context -d \'{"fromDateIso":"<7 days ago ISO>"}\'');
});
