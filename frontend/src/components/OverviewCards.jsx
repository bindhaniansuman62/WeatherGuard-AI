import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Radio,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { AnimatedNumber } from './MotionPrimitives';

export default function OverviewCards({ overview }) {
  const cards = [
    {
      label: 'Total Stations',
      value: overview.totalStations,
      suffix: '',
      sublabel: 'Simulated AWS Telemetry Nodes',
      icon: Radio,
      tone: 'blue',
    },
    {
      label: 'Healthy Stations',
      value: overview.healthyStations,
      suffix: '',
      sublabel: 'Nominal Calibration Verified',
      icon: CheckCircle2,
      tone: 'green',
    },
    {
      label: 'Warning Stations',
      value: overview.warningStations,
      suffix: '',
      sublabel: 'Drift / Stalled Diagnostics',
      icon: AlertTriangle,
      tone: 'amber',
    },
    {
      label: 'Critical Stations',
      value: overview.criticalStations,
      suffix: '',
      sublabel: 'Immediate Intervention Required',
      icon: AlertOctagon,
      tone: 'red',
    },
    {
      label: 'Avg Station Health',
      value: overview.averageHealth,
      suffix: '%',
      sublabel: 'Fleet Integrity Index',
      icon: Activity,
      tone:
        overview.averageHealth >= 85
          ? 'green'
          : overview.averageHealth >= 70
            ? 'amber'
            : 'red',
    },
  ];

  return (
    <section className="overview-grid" aria-label="Network Overview KPIs">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <motion.article
            key={card.label}
            className={`kpi-card kpi-${card.tone}`}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{
              duration: 0.35,
              delay: idx * 0.055,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className="kpi-top">
              <span className="kpi-label">{card.label}</span>
              <span className="kpi-icon-wrap">
                <Icon size={17} />
              </span>
            </div>
            <div className="kpi-value">
              <AnimatedNumber value={card.value} suffix={card.suffix} />
            </div>
            <div className="kpi-sub">{card.sublabel}</div>
          </motion.article>
        );
      })}
    </section>
  );
}
