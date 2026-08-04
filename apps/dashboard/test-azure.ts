import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import fs from 'fs';
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function main() {
    const endpoint = process.env.AZURE_DI_ENDPOINT || process.env.AZURE_CV_ENDPOINT;
    const apiKey = process.env.AZURE_DI_KEY || process.env.AZURE_CV_KEY;

    if (!endpoint || !apiKey) {
        console.error('No credentials');
        return;
    }

    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
    
    console.log('Fetching PDF from Urreanet...');
    const url = 'https://www.urreanet.com/urreanetnuevo/data/FichasTecnicasN/FTDOC3735.pdf';
    const resp = await fetch(url);
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log('Sending to Azure DI (prebuilt-layout)...');
    const poller = await client.beginAnalyzeDocument('prebuilt-layout', buffer);
    const result = await poller.pollUntilDone();

    console.log('\n--- AZURE DI RESULTS ---');
    console.log('Content Length:', result.content?.length || 0);
    console.log('Content Preview:', result.content ? result.content.slice(0, 500) : 'NO CONTENT');
    console.log('Pages:', result.pages?.length || 0);
    console.log('Tables:', result.tables?.length || 0);

    const pages = result.pages ?? [];
    const avgConf = pages.length > 0
        ? pages.reduce((sum: number, p: any) =>
            sum + (p.words?.reduce((ws: number, w: any) => ws + (w.confidence ?? 1), 0) ?? 0) /
                   Math.max(p.words?.length ?? 1, 1), 0) / pages.length
        : 0;

    console.log('Calculated Confidence:', Math.round(avgConf * 100) / 100);
}

main().catch(console.error);
