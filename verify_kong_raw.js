
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const iconv = require('iconv-lite');

function fixEncoding(str) {
    if (typeof str !== 'string') return str;
    try {
        return iconv.decode(Buffer.from(str, 'binary'), 'euc-kr');
    } catch (e) { return str; }
}

async function verifyKongRawData() {
    try {
        const date = '2026-02-06';
        console.log(`=== [실측] ${date} 하(바른) 콩나물 데이터 분석 ===`);

        // 1. 하(바른) 기사님의 콩나물 분류 데이터 전체 주문 라인을 가져옵니다.
        const rows = await prisma.$queryRaw`
            SELECT b.B_P_NO, b.B_P_NAME, p.P_DIV_PICK
            FROM t_balju b
            LEFT JOIN t_product p ON b.B_P_NO = p.P_CODE
            WHERE b.B_DATE = ${date}
            AND CONVERT(CAST(b.CB_DRIVER AS BINARY) USING euckr) = '하(바른)'
            AND CONVERT(CAST(p.P_DIV_PICK AS BINARY) USING euckr) = '콩나물'
        `;

        if (rows.length === 0) {
            console.log("해당하는 콩나물 데이터를 찾지 못했습니다.");
            return;
        }

        const totalLines = rows.length;
        const uniqueProducts = new Set(rows.map(r => r.B_P_NO));

        console.log(`- 전체 주문 라인 수: ${totalLines} 줄`);
        console.log(`- 이 중 고유한 품목(P_CODE)의 종류: ${uniqueProducts.size} 종`);

        console.log("\n--- 상세 품목 리스트 (중복 확인용) ---");
        const grouped = {};
        rows.forEach(r => {
            const key = r.B_P_NO;
            if (!grouped[key]) grouped[key] = { name: fixEncoding(r.B_P_NAME), count: 0 };
            grouped[key].count++;
        });

        Object.keys(grouped).forEach(key => {
            console.log(`품목: ${grouped[key].name} (${key}), 겹친줄수: ${grouped[key].count}`);
        });

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

verifyKongRawData();
