import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'Balance — Your portfolio. A clearer perspective. Read-only portfolio planning.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const font = await readFile(join(process.cwd(), 'public/fonts/manrope-bold.ttf'));
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#f8f9f6',
        color: '#172b23',
        display: 'flex',
        padding: '58px 64px',
        fontFamily: 'Manrope',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontSize: 35,
            letterSpacing: -2,
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              justifyContent: 'center',
              width: 44,
              height: 44,
              borderRadius: 12,
              background: '#214c38',
              marginRight: 5,
            }}
          >
            <div
              style={{
                width: 5,
                height: 19,
                background: '#d5f479',
                borderRadius: 3,
                transform: 'rotate(20deg)',
              }}
            />
            <div
              style={{
                width: 5,
                height: 29,
                background: '#d5f479',
                borderRadius: 3,
                transform: 'rotate(20deg)',
              }}
            />
            <div
              style={{
                width: 5,
                height: 23,
                background: '#d5f479',
                borderRadius: 3,
                transform: 'rotate(20deg)',
              }}
            />
          </div>
          balance.
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 65,
            fontSize: 68,
            letterSpacing: -3,
            lineHeight: 1.1,
            maxWidth: 690,
          }}
        >
          <div style={{ display: 'flex' }}>Your portfolio.</div>
          <div style={{ display: 'flex' }}>A clearer</div>
          <div style={{ display: 'flex', color: '#4e7458' }}>perspective.</div>
        </div>
        <div style={{ display: 'flex', marginTop: 34, color: '#50624e', fontSize: 21 }}>
          Your targets. Your boundaries. A clearer next move.
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            fontSize: 14,
            color: '#50624e',
            letterSpacing: 2,
          }}
        >
          READ-ONLY PORTFOLIO PLANNING
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'absolute',
          right: 65,
          top: 185,
          width: 300,
          background: '#184d3b',
          color: '#f6f7f1',
          padding: 30,
          borderRadius: 18,
        }}
      >
        <div style={{ display: 'flex', fontSize: 13, letterSpacing: 2, color: '#cedbc2' }}>
          ONE CONSIDERED PLAN
        </div>
        {[
          ['Account 01', '85%'],
          ['Account 02', '65%'],
          ['Account 03', '45%'],
        ].map(([label, width], index) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', marginTop: 27 }}>
            <div style={{ display: 'flex', fontSize: 15, color: '#e1e9d8' }}>{label}</div>
            <div
              style={{
                display: 'flex',
                height: 9,
                width: '100%',
                background: '#37634d',
                borderRadius: 5,
                marginTop: 12,
              }}
            >
              <div
                style={{
                  width,
                  height: 9,
                  background: ['#c6d9b2', '#94b39b', '#d5b77b'][index],
                  borderRadius: 5,
                }}
              />
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', marginTop: 30, fontSize: 13, color: '#cedbc2' }}>
          Every decision stays yours.
        </div>
      </div>
    </div>,
    { ...size, fonts: [{ name: 'Manrope', data: font, style: 'normal', weight: 700 }] },
  );
}
