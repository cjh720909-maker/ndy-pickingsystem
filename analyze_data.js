
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function analyzeHaBar() {
    try {
        console.log("--- '하바른' 관련 콩나물 데이터 정밀 분석 ---");
        // '하바른'이 포함된 배차명의 원본 데이터를 가져옵니다.
        const rows = await prisma.$queryRaw`
            SELECT B_DATE, CB_DRIVER, B_P_NO, B_P_NAME, B_QTY 
            FROM t_balju 
            WHERE B_DATE >= '2026-02-01' 
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하바른%'
            LIMIT 100
        `;

        if (rows.length === 0) {
            console.log("'하바른' 데이터를 찾지 못했습니다. 날짜나 배차명을 다시 확인해야 할 것 같습니다.");
            return;
        }

        console.log(`총 ${rows.length}행 발견. 데이터 샘플 분석:`);
        rows.forEach((r, i) => {
            const driver = fixEncoding(r.CB_DRIVER);
            const pName = fixEncoding(r.B_P_NAME);
            console.log(`[${i + 1}] 배차명: "${driver}" (길이: ${driver ? driver.length : 0}), 품목: ${pName} (${r.B_P_NO}), 수량: ${r.B_QTY}`);
        });

    } catch (e) {
        console.error("분석 중 에러:", e);
    } finally {
        await prisma.$disconnect();
    }
}

analyzeHaBar();
