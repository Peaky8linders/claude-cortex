from setuptools import setup, find_packages

setup(
    name="claude-cortex",
    version="0.3.0",
    description="Graph-based self-learning memory system for Claude Code",
    author="Peaky8linders",
    url="https://github.com/Peaky8linders/claude-cortex",
    packages=find_packages(),
    python_requires=">=3.10",
    install_requires=[
        "sentence-transformers>=2.2.0",
        "numpy>=1.24.0",
    ],
    entry_points={
        "console_scripts": [
            "brainiac=brainiac.cli:main",
        ],
    },
    classifiers=[
        "Development Status :: 3 - Alpha",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Programming Language :: Python :: 3.12",
    ],
)
