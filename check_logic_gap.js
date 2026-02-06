
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function verifyLogics() {
    try {
        console.log("--- '하바른' 기사님 데이터 집중 분석 ---");

        // 1. 하바른 기사님의 데이터를 가져와서 CB_IDX와 CB_DRIVER가 어떻게 기록되는지 봅니다.
        const samples = await prisma.$queryRaw`
            SELECT B_DATE, CB_IDX, CB_DRIVER, B_P_NO, B_P_NAME 
            FROM t_balju 
            WHERE B_DATE >= '2026-02-01'
            AND CONVERT(CAST(CB_DRIVER AS BINARY) USING euckr) LIKE '%하바른%'
            LIMIT 20
        `;

        if (samples.length === 0) {
            console.log("데이터를 찾을 수 없습니다.");
            return;
        }

        console.log(`확인된 샘플: ${samples.length}건`);
        samples.forEach((s, i) => {
            console.log(`[${i + 1}] 날짜: ${s.B_DATE}, CB_IDX: ${s.CB_IDX}, 배차명: "${fixEncoding(s.CB_DRIVER)}", 품목: ${fixEncoding(s.B_P_NAME)}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyLogics();
