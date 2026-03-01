import { NextRequest, NextResponse } from 'next/server';
import { processProductDocument } from '../../../../../../packages/sync/autoficha';

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No se subió ningún archivo' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await processProductDocument(buffer, file.name);

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Error in API Autoficha:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
