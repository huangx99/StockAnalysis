from pydantic import BaseModel


class AIAnalysis(BaseModel):
    summary: str
    score: int
    style: str
    companyOverview: str = ""
    marketPerformance: str = ""
    financialPerformance: str = ""
    valuationAnalysis: str = ""
    newsDigest: str = ""
    highlights: list[str]
    risks: list[str]
    conclusion: str


class AIReportSection(BaseModel):
    title: str
    content: str


class AIReport(BaseModel):
    sections: list[AIReportSection]
    generatedAt: str
