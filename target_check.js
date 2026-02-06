
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function analyzeHaBarDirect() {
    try {
        console.log("--- '하(바른)' 데이터 정밀 분석 시작 ---");

        // 모든 배차명을 가져와서 '하(바른)'이 포함된 것을 찾습니다.
        const allDrivers = await prisma.$queryRaw`SELECT DISTINCT CB_DRIVER FROM t_balju WHERE B_DATE >= '2026-02-01'`;
        const targetRawNames = allDrivers.filter(d => fixEncoding(d.CB_DRIVER).includes("하(바른)"));

        if (targetRawNames.length === 0) {
            console.log("'하(바른)' 명칭을 포함한 데이터를 여전히 못 찾았습니다. 인코딩된 바이너리 값을 직접 비교해야 할 것 같습니다.");
            return;
        }

        console.log(`매칭된 원본 명칭들:`, targetRawNames.map(d => fixEncoding(d.CB_DRIVER)));

        const query = `
            SELECT B_DATE, CB_IDX, CB_DRIVER, B_P_NO, B_P_NAME, COUNT(*) as row_count
            FROM t_balju 
            WHERE B_DATE >= '2026-02-01'
            AND CB_DRIVER IN (${targetRawNames.map(d => `'${d.CB_DRIVER}'`).join(',')})
            GROUP BY B_DATE, CB_IDX, CB_DRIVER, B_P_NO, B_P_NAME
            LIMIT 50
        `;

        const rows = await prisma.$queryRawUnsafe(query);
        console.log(`조회 결과 ${rows.length}개 그룹 발견:`);

        rows.forEach((r, i) => {
            console.log(`[${i + 1}] 날짜:${r.B_DATE}, ID:${r.CB_IDX}, 명칭:"${fixEncoding(r.CB_DRIVER)}", 품목:${fixEncoding(r.B_P_NAME)}(${r.B_P_NO}), 라인수:${r.row_count}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

analyzeHaBarDirect();
